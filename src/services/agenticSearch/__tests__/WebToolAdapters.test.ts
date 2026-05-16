import { describe, expect, test } from 'bun:test'
import { WebFetchTool } from '@deepcode/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import {
  createWebFetchToolAdapter,
  normalizeWebFetchOutput,
} from '../WebToolAdapters.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { createAssistantMessage } from '../../../utils/messages.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../../Tool.js'

describe('Agentic Search web tool adapters', () => {
  test('normalizes WebFetch output into executor evidence response', () => {
    expect(
      normalizeWebFetchOutput({
        data: {
          bytes: 120,
          code: 200,
          codeText: 'OK',
          result: 'Primary docs support the claim.',
          durationMs: 42,
          url: 'https://docs.example.test/reference',
        },
      }),
    ).toEqual({
      content: 'Primary docs support the claim.',
      title: 'docs.example.test',
      durationMs: 42,
    })
  })

  test('denies non-preapproved WebFetch permission prompts by default', async () => {
    const adapter = createWebFetchToolAdapter({
      toolUseContext: toolUseContext(),
      canUseTool: async () => {
        throw new Error('canUseTool should not be called for default deny')
      },
      parentMessage: parentMessage(),
      webFetchToolCall: async () => {
        throw new Error('WebFetch call should not run without permission')
      },
    })

    await expect(
      adapter({
        url: 'https://example.com/private-doc',
        prompt: 'extract evidence',
      }),
    ).rejects.toThrow('Claude requested permissions to use WebFetch')
  })

  test('delegates permission prompts and calls WebFetch when allowed', async () => {
    const calledInputs: unknown[] = []
    const canUseTool: CanUseToolFn = async (_tool, input) => ({
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'test allow' },
    })
    const adapter = createWebFetchToolAdapter({
      toolUseContext: toolUseContext(),
      canUseTool,
      parentMessage: parentMessage(),
      askPolicy: 'delegate',
      webFetchToolCall: async input => {
        calledInputs.push(input)
        return {
          data: {
            bytes: 10,
            code: 200,
            codeText: 'OK',
            result: `fetched ${input.url}`,
            durationMs: 7,
            url: input.url,
          },
        }
      },
    })

    const result = await adapter({
      url: 'https://example.com/public-doc',
      prompt: 'extract evidence',
    })

    expect(calledInputs).toEqual([
      {
        url: 'https://example.com/public-doc',
        prompt: 'extract evidence',
      },
    ])
    expect(result).toEqual({
      content: 'fetched https://example.com/public-doc',
      title: 'example.com',
      durationMs: 7,
    })
  })

  test('uses WebFetch preapproved host rules without prompting', async () => {
    let canUseToolCalled = false
    const adapter = createWebFetchToolAdapter({
      toolUseContext: toolUseContext(),
      canUseTool: async () => {
        canUseToolCalled = true
        return {
          behavior: 'deny',
          message: 'unexpected',
          decisionReason: { type: 'other', reason: 'unexpected' },
        }
      },
      parentMessage: parentMessage(),
      webFetchToolCall: async input => ({
        data: {
          bytes: 10,
          code: 200,
          codeText: 'OK',
          result: `docs ${input.url}`,
          durationMs: 5,
          url: input.url,
        },
      }),
    })

    const result = await adapter({
      url: 'https://docs.python.org/3/library/json.html',
      prompt: 'extract evidence',
    })

    expect(canUseToolCalled).toBe(false)
    expect(result.content).toContain('docs https://docs.python.org')
  })
})

function parentMessage() {
  return createAssistantMessage({
    content: 'Agentic Search evidence collection',
    isVirtual: true,
  })
}

function toolUseContext(): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5-20250929',
      tools: [WebFetchTool],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
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
        toolPermissionContext: getEmptyToolPermissionContext(),
        fastMode: false,
        mcp: { tools: [], clients: [] },
      }) as never,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}
