import { mkdtemp, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { BashTool } from '@deepcode/builtin-tools/tools/BashTool/BashTool.js'
import { createAgenticSearchSourceRunner } from '../SourceRunnerAdapters.js'
import { extractAgenticSearchEvidence } from '../AgenticSearchEvidence.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'

describe('Agentic Search source runner adapters', () => {
  test('collects local rg evidence and file summaries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-source-local-'))
    await writeFile(
      join(cwd, 'README.md'),
      'Agentic Search supports local implementation evidence.\n',
    )
    await writeFile(join(cwd, 'package.json'), '{"name":"fixture"}\n')
    const runner = createAgenticSearchSourceRunner({
      toolUseContext: toolUseContext({ tools: [] }),
      cwd,
      ripgrep: async input => [
        `README.md:1:${input.query} supports local implementation evidence`,
      ],
      now: fixedClock(),
    })

    const result = await runner({
      source: 'local_search',
      query: 'Agentic Search implementation evidence',
      purpose: 'collect local evidence',
      stepId: 'local-1',
      round: 1,
      contextMaxCharacters: 1_000,
    })

    expect(result.evidence.map(item => item.metadata?.runner)).toContain(
      'local_rg',
    )
    expect(result.evidence.map(item => item.metadata?.runner)).toContain(
      'local_file',
    )
    const extraction = extractAgenticSearchEvidence(
      result.evidence.map((item, index) => ({
        source: 'local_search',
        query: 'Agentic Search implementation evidence',
        stepId: 'local-1',
        round: 1,
        status: 'collected',
        content: item.content,
        chars: item.content.length,
        durationMs: item.durationMs ?? index,
        title: item.title,
        url: item.url,
      })),
    )
    expect(extraction.summary.localClaimCount).toBeGreaterThan(0)
  })

  test('runs Bash source only through a read-only command by default', async () => {
    const commands: string[] = []
    const runner = createAgenticSearchSourceRunner({
      toolUseContext: toolUseContext({ tools: [BashTool] }),
      cwd: '/repo',
      bashToolCall: async input => {
        commands.push(input.command)
        return {
          data: {
            stdout: 'src/query.ts:1:Agentic Search supports Bash evidence',
            stderr: '',
            interrupted: false,
          },
        }
      },
      now: fixedClock(),
    })

    const result = await runner({
      source: 'bash_search',
      query: 'Agentic Search Bash evidence',
      purpose: 'collect bash evidence',
      stepId: 'bash-1',
      round: 1,
      contextMaxCharacters: 1_000,
    })

    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('rg -n -i')
    expect(result.evidence[0]?.metadata).toMatchObject({
      runner: 'bash',
      readOnly: true,
    })
    expect(result.evidence[0]?.content).toContain('Bash evidence')
  })

  test('delegates Bash permission prompts when explicitly configured', async () => {
    const delegated: unknown[] = []
    const canUseTool: CanUseToolFn = async (_tool, input) => {
      delegated.push(input)
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'other', reason: 'test delegation' },
      }
    }
    const runner = createAgenticSearchSourceRunner({
      toolUseContext: toolUseContext({
        tools: [BashTool],
        permissionMode: 'default',
      }),
      canUseTool,
      bashAskPolicy: 'delegate',
      bashCommandBuilder: () => ({
        command: 'node -e "console.log(123)"',
        description: 'Run delegated evidence command',
        timeout: 8_000,
      }),
      bashToolCall: async () => ({
        data: {
          stdout: 'delegated bash evidence',
          stderr: '',
          interrupted: false,
        },
      }),
      now: fixedClock(),
    })

    const result = await runner({
      source: 'bash_search',
      query: 'delegated bash evidence',
      purpose: 'collect bash evidence',
      stepId: 'bash-2',
      round: 1,
    })

    expect(delegated).toHaveLength(1)
    expect(result.evidence[0]?.metadata?.permissionDelegated).toBe(true)
  })

  test('collects private MCP tool and resource evidence', async () => {
    const mcpTool = createMcpSearchTool()
    const client = createMcpClient()
    const runner = createAgenticSearchSourceRunner({
      toolUseContext: toolUseContext({
        tools: [mcpTool],
        mcpClients: [client],
        mcpResources: {
          private: [
            {
              server: 'private',
              uri: 'doc://agentic-search-rollout',
              name: 'Agentic Search rollout',
              description: 'private agentic search evidence',
            },
          ],
        },
      }),
      now: fixedClock(),
    })

    const result = await runner({
      source: 'mcp_search',
      query: 'agentic search private evidence',
      purpose: 'collect private evidence',
      stepId: 'mcp-1',
      round: 1,
      contextMaxCharacters: 2_000,
    })

    expect(result.evidence.map(item => item.metadata?.runner)).toContain(
      'mcp_tool',
    )
    expect(result.evidence.map(item => item.metadata?.runner)).toContain(
      'mcp_resource',
    )
    expect(result.evidence.map(item => item.content).join('\n')).toContain(
      'Private MCP resource supports Agentic Search.',
    )
  })
})

function toolUseContext({
  tools,
  mcpClients = [],
  mcpResources = {},
  permissionMode = 'bypassPermissions',
}: {
  tools: Tool[]
  mcpClients?: ToolUseContext['options']['mcpClients']
  mcpResources?: ToolUseContext['options']['mcpResources']
  permissionMode?: ToolUseContext['getAppState'] extends () => infer State
    ? State extends { toolPermissionContext: { mode: infer Mode } }
      ? Mode
      : never
    : never
}): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5-20250929',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients,
      mcpResources,
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: [],
        allowedAgentTypes: [],
      },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () =>
      ({
        settings: {},
        toolPermissionContext: {
          ...getEmptyToolPermissionContext(),
          mode: permissionMode,
        },
        fastMode: false,
        mcp: { tools, clients: mcpClients },
      }) as never,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

function createMcpSearchTool(): Tool {
  const schema = z.object({ query: z.string() })
  return {
    name: 'mcp__private__search',
    isMcp: true,
    mcpInfo: { serverName: 'private', toolName: 'search' },
    searchHint: 'search private docs',
    inputJSONSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
    inputSchema: schema,
    async call(input: { query: string }) {
      return {
        data: {
          result: `Private MCP tool supports ${input.query}.`,
        },
      }
    },
    async checkPermissions() {
      return { behavior: 'allow' }
    },
    async description() {
      return 'Search private docs'
    },
    async prompt() {
      return 'Search private docs'
    },
    isConcurrencySafe() {
      return true
    },
    isReadOnly() {
      return true
    },
    isEnabled() {
      return true
    },
    userFacingName() {
      return 'private search'
    },
  } as unknown as Tool
}

function createMcpClient(): ToolUseContext['options']['mcpClients'][number] {
  return {
    type: 'connected',
    name: 'private',
    capabilities: { resources: {} },
    config: { type: 'stdio', command: 'fixture', scope: 'local' },
    cleanup: async () => {},
    client: {
      request: async () => ({
        contents: [
          {
            uri: 'doc://agentic-search-rollout',
            text: 'Private MCP resource supports Agentic Search.',
          },
        ],
      }),
    },
  } as unknown as ToolUseContext['options']['mcpClients'][number]
}

function fixedClock(): () => number {
  let now = 100
  return () => now++
}
