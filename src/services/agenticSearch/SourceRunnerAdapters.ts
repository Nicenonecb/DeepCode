import { readFile } from 'fs/promises'
import path from 'path'
import {
  ReadResourceResultSchema,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { BashTool } from '@deepcode/builtin-tools/tools/BashTool/BashTool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { getCwd } from '../../utils/cwd.js'
import { recursivelySanitizeUnicode } from '../../utils/sanitization.js'
import { ripGrep } from '../../utils/ripgrep.js'
import type { PermissionDecision } from '../../types/permissions.js'
import type { AssistantMessage } from '../../types/message.js'
import type {
  AgenticSearchExecutorAdapters,
  AgenticSearchSourceRequest,
  AgenticSearchSourceResponse,
} from './types.js'

type SourceEvidence = AgenticSearchSourceResponse['evidence'][number]

type BashToolInput = {
  command: string
  description?: string
  timeout?: number
  [key: string]: unknown
}

type BashToolOutput = {
  stdout: string
  stderr: string
  interrupted: boolean
}

type BashToolRuntime = Tool<typeof BashTool.inputSchema, BashToolOutput>

export type AgenticSearchSourceRunnerOptions = {
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  parentMessage?: AssistantMessage
  cwd?: string
  maxLocalFiles?: number
  maxMcpTools?: number
  maxMcpResources?: number
  bashAskPolicy?: 'deny' | 'delegate'
  bashToolCall?: (input: BashToolInput) => Promise<{ data: BashToolOutput }>
  bashCommandBuilder?: (request: AgenticSearchSourceRequest) => BashToolInput
  localSearch?: (
    request: AgenticSearchSourceRequest,
  ) => Promise<AgenticSearchSourceResponse>
  mcpSearch?: (
    request: AgenticSearchSourceRequest,
  ) => Promise<AgenticSearchSourceResponse>
  bashSearch?: (
    request: AgenticSearchSourceRequest,
  ) => Promise<AgenticSearchSourceResponse>
  ripgrep?: (input: {
    query: string
    cwd: string
    signal: AbortSignal
  }) => Promise<string[]>
  now?: () => number
}

export function createAgenticSearchSourceRunner({
  toolUseContext,
  canUseTool,
  parentMessage = createAgenticSearchParentMessage(),
  cwd = getCwd(),
  maxLocalFiles = 5,
  maxMcpTools = 3,
  maxMcpResources = 3,
  bashAskPolicy = 'deny',
  bashToolCall,
  localSearch,
  mcpSearch,
  bashSearch,
  ripgrep,
  bashCommandBuilder,
  now = Date.now,
}: AgenticSearchSourceRunnerOptions): NonNullable<
  AgenticSearchExecutorAdapters['sourceRunner']
> {
  return async request => {
    switch (request.source) {
      case 'local_search':
        return localSearch
          ? localSearch(request)
          : runLocalSearch({
              request,
              toolUseContext,
              cwd,
              maxLocalFiles,
              ripgrep,
              now,
            })
      case 'mcp_search':
        return mcpSearch
          ? mcpSearch(request)
          : runMcpSearch({
              request,
              toolUseContext,
              parentMessage,
              maxMcpTools,
              maxMcpResources,
              now,
            })
      case 'bash_search':
        return bashSearch
          ? bashSearch(request)
          : runBashSearch({
              request,
              toolUseContext,
              canUseTool,
              parentMessage,
              cwd,
              askPolicy: bashAskPolicy,
              bashToolCall,
              bashCommandBuilder,
              now,
            })
    }
  }
}

async function runLocalSearch({
  request,
  toolUseContext,
  cwd,
  maxLocalFiles,
  ripgrep,
  now,
}: {
  request: AgenticSearchSourceRequest
  toolUseContext: ToolUseContext
  cwd: string
  maxLocalFiles: number
  ripgrep?: AgenticSearchSourceRunnerOptions['ripgrep']
  now: () => number
}): Promise<AgenticSearchSourceResponse> {
  const startedAt = now()
  const query = normalizeQuery(request.query)
  const rgEvidence = await runRipgrepEvidence({
    query,
    cwd,
    signal: toolUseContext.abortController.signal,
    contextMaxCharacters: request.contextMaxCharacters,
    now,
    startedAt,
    ripgrep,
  })
  const files = localCandidateFiles(query, maxLocalFiles)
  const fileEvidence = await Promise.all(
    files.map(file =>
      readLocalFileEvidence({
        file,
        query,
        cwd,
        contextMaxCharacters: request.contextMaxCharacters,
        now,
        startedAt,
      }),
    ),
  )

  return {
    evidence: [rgEvidence, ...fileEvidence.filter(isSourceEvidence)],
  }
}

async function runMcpSearch({
  request,
  toolUseContext,
  parentMessage,
  maxMcpTools,
  maxMcpResources,
  now,
}: {
  request: AgenticSearchSourceRequest
  toolUseContext: ToolUseContext
  parentMessage: AssistantMessage
  maxMcpTools: number
  maxMcpResources: number
  now: () => number
}): Promise<AgenticSearchSourceResponse> {
  const startedAt = now()
  const evidence: SourceEvidence[] = []
  const query = request.query
  const tools = toolUseContext.options.tools
    .filter(tool => tool.isMcp && isSearchOrReadMcpTool(tool, query))
    .slice(0, maxMcpTools)

  const canUseTool: CanUseToolFn = async () => ({
    behavior: 'deny',
    message: 'Agentic Search MCP source runner does not delegate prompts.',
    decisionReason: {
      type: 'other',
      reason: 'Agentic Search MCP source runner requires pre-approved tools.',
    },
  })

  for (const tool of tools) {
    const input = buildMcpSearchInput(tool, query)
    if (!input) continue
    try {
      const validation = await tool.validateInput?.(input, toolUseContext)
      if (validation?.result === false) continue
      const permission = await tool.checkPermissions(input, toolUseContext)
      if (permission.behavior !== 'allow') continue
      const result = await tool.call(
        permission.updatedInput ?? input,
        toolUseContext,
        canUseTool,
        parentMessage,
      )
      const content = mcpToolResultText(result.data)
      if (!content) continue
      evidence.push({
        title: `MCP ${tool.name}`,
        url: mcpUrl(tool.mcpInfo?.serverName, tool.mcpInfo?.toolName),
        content: trimToBudget(content, request.contextMaxCharacters),
        durationMs: now() - startedAt,
        metadata: {
          runner: 'mcp_tool',
          serverName: tool.mcpInfo?.serverName,
          toolName: tool.mcpInfo?.toolName ?? tool.name,
        },
      })
    } catch {}
  }

  evidence.push(
    ...(await readMatchingMcpResources({
      request,
      toolUseContext,
      maxMcpResources,
      startedAt,
      now,
    })),
  )

  if (evidence.length === 0) {
    throw new Error(
      'No connected MCP search/read tool or matching MCP resource produced evidence.',
    )
  }

  return { evidence }
}

async function runBashSearch({
  request,
  toolUseContext,
  canUseTool,
  parentMessage,
  cwd,
  askPolicy,
  bashToolCall,
  bashCommandBuilder,
  now,
}: {
  request: AgenticSearchSourceRequest
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  parentMessage: AssistantMessage
  cwd: string
  askPolicy: 'deny' | 'delegate'
  bashToolCall?: (input: BashToolInput) => Promise<{ data: BashToolOutput }>
  bashCommandBuilder?: AgenticSearchSourceRunnerOptions['bashCommandBuilder']
  now: () => number
}): Promise<AgenticSearchSourceResponse> {
  const startedAt = now()
  const input = bashCommandBuilder
    ? bashCommandBuilder(request)
    : buildReadOnlyBashInput(request.query)
  const bashTool = BashTool as BashToolRuntime
  const parsedInput = bashTool.inputSchema.safeParse(input)
  if (!parsedInput.success) {
    throw new Error(`Bash source input validation failed: ${parsedInput.error}`)
  }

  const validation = await bashTool.validateInput?.(
    parsedInput.data,
    toolUseContext,
  )
  if (validation?.result === false) {
    throw new Error(validation.message)
  }

  const isReadOnly = bashTool.isReadOnly(parsedInput.data)
  const permission = await bashTool.checkPermissions(
    parsedInput.data,
    toolUseContext,
  )
  const decision = await resolveBashPermission({
    permission,
    bashTool,
    input: parsedInput.data,
    toolUseContext,
    canUseTool,
    parentMessage,
    askPolicy,
  })
  if (decision.behavior !== 'allow') {
    throw new Error(decision.message || 'Bash source permission denied.')
  }

  const result = await (bashToolCall
    ? bashToolCall(decision.updatedInput ?? parsedInput.data)
    : bashTool.call(
        decision.updatedInput ?? parsedInput.data,
        { ...toolUseContext, agentId: toolUseContext.agentId },
        canUseTool ?? denyCanUseTool,
        parentMessage,
      ))
  const content = [result.data.stdout, result.data.stderr]
    .filter(Boolean)
    .join('\n')

  return {
    evidence: [
      {
        title: 'Bash read-only source evidence',
        url: `file://${cwd}`,
        content: trimToBudget(content, request.contextMaxCharacters),
        durationMs: now() - startedAt,
        metadata: {
          runner: 'bash',
          command: (decision.updatedInput ?? parsedInput.data).command,
          readOnly: isReadOnly,
          permissionDelegated: askPolicy === 'delegate',
        },
      },
    ],
  }
}

async function runRipgrepEvidence({
  query,
  cwd,
  signal,
  contextMaxCharacters,
  now,
  startedAt,
  ripgrep,
}: {
  query: string
  cwd: string
  signal: AbortSignal
  contextMaxCharacters?: number
  now: () => number
  startedAt: number
  ripgrep?: AgenticSearchSourceRunnerOptions['ripgrep']
}): Promise<SourceEvidence> {
  const terms = queryTerms(query)
  const pattern = terms.length > 0 ? terms.join('|') : query
  const lines = ripgrep
    ? await ripgrep({ query: pattern, cwd, signal })
    : await ripGrep(
        [
          '--hidden',
          '--max-columns',
          '300',
          '--glob',
          '!.git',
          '--glob',
          '!node_modules',
          '--glob',
          '!dist',
          '-n',
          '-i',
          '-m',
          '4',
          pattern,
        ],
        cwd,
        signal,
      )
  const output =
    lines.slice(0, 80).join('\n') || 'No local ripgrep matches found.'

  return {
    title: 'Local rg evidence',
    url: `file://${cwd}`,
    content: trimToBudget(output, contextMaxCharacters),
    durationMs: now() - startedAt,
    metadata: {
      runner: 'local_rg',
      command: `rg -n -i ${JSON.stringify(pattern)} .`,
      path: cwd,
      readOnly: true,
    },
  }
}

async function readLocalFileEvidence({
  file,
  query,
  cwd,
  contextMaxCharacters,
  now,
  startedAt,
}: {
  file: string
  query: string
  cwd: string
  contextMaxCharacters?: number
  now: () => number
  startedAt: number
}): Promise<SourceEvidence | undefined> {
  const absolutePath = path.resolve(cwd, file)
  if (!isInsideDirectory(absolutePath, cwd)) return undefined
  try {
    const content = await readFile(absolutePath, 'utf8')
    const summary = summarizeFileContent(content, query)
    if (!summary) return undefined
    return {
      title: file,
      url: `file://${absolutePath}`,
      content: trimToBudget(summary, contextMaxCharacters),
      durationMs: now() - startedAt,
      metadata: {
        runner: 'local_file',
        path: file,
        readOnly: true,
      },
    }
  } catch {
    return undefined
  }
}

async function readMatchingMcpResources({
  request,
  toolUseContext,
  maxMcpResources,
  startedAt,
  now,
}: {
  request: AgenticSearchSourceRequest
  toolUseContext: ToolUseContext
  maxMcpResources: number
  startedAt: number
  now: () => number
}): Promise<SourceEvidence[]> {
  const resources = Object.values(toolUseContext.options.mcpResources)
    .flat()
    .filter(resource => resourceMatches(resource, request.query))
    .slice(0, maxMcpResources)
  const evidence: SourceEvidence[] = []

  for (const resource of resources) {
    const client = toolUseContext.options.mcpClients.find(
      candidate =>
        candidate.name === resource.server && candidate.type === 'connected',
    )
    if (!client || client.type !== 'connected') continue
    try {
      const result = (await client.client.request(
        {
          method: 'resources/read',
          params: { uri: resource.uri },
        },
        ReadResourceResultSchema,
      )) as ReadResourceResult
      const content = result.contents
        .map(item => ('text' in item ? item.text : undefined))
        .filter(isString)
        .join('\n')
      if (!content) continue
      evidence.push({
        title: resource.name ?? resource.uri,
        url: resource.uri,
        content: trimToBudget(
          recursivelySanitizeUnicode(content),
          request.contextMaxCharacters,
        ),
        durationMs: now() - startedAt,
        metadata: {
          runner: 'mcp_resource',
          serverName: resource.server,
        },
      })
    } catch {}
  }

  return evidence
}

async function resolveBashPermission({
  permission,
  bashTool,
  input,
  toolUseContext,
  canUseTool,
  parentMessage,
  askPolicy,
}: {
  permission: Awaited<ReturnType<BashToolRuntime['checkPermissions']>>
  bashTool: BashToolRuntime
  input: BashToolInput
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  parentMessage: AssistantMessage
  askPolicy: 'deny' | 'delegate'
}): Promise<PermissionDecision<BashToolInput>> {
  if (permission.behavior === 'allow' || permission.behavior === 'deny') {
    if (
      permission.behavior === 'deny' &&
      askPolicy === 'delegate' &&
      canUseTool
    ) {
      return (await canUseTool(
        bashTool,
        input,
        toolUseContext,
        parentMessage,
        `agentic-search-bash-${stableHash(input.command).toString(36)}`,
      )) as PermissionDecision<BashToolInput>
    }
    return permission as PermissionDecision<BashToolInput>
  }
  if (permission.behavior === 'ask' && askPolicy === 'delegate' && canUseTool) {
    return (await canUseTool(
      bashTool,
      input,
      toolUseContext,
      parentMessage,
      `agentic-search-bash-${stableHash(input.command).toString(36)}`,
      permission,
    )) as PermissionDecision<BashToolInput>
  }
  if (
    permission.behavior === 'passthrough' &&
    askPolicy === 'delegate' &&
    canUseTool
  ) {
    return (await canUseTool(
      bashTool,
      input,
      toolUseContext,
      parentMessage,
      `agentic-search-bash-${stableHash(input.command).toString(36)}`,
    )) as PermissionDecision<BashToolInput>
  }
  if (bashTool.isReadOnly(input)) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Agentic Search allows Bash source runner read-only commands.',
      },
    }
  }
  return {
    behavior: 'deny',
    message: permission.message,
    decisionReason: {
      type: 'other',
      reason:
        'Agentic Search Bash source runner only allows read-only or explicitly delegated commands.',
    },
  }
}

function buildReadOnlyBashInput(query: string): BashToolInput {
  const terms = queryTerms(query)
  const pattern = terms.length > 0 ? terms.join('|') : normalizeQuery(query)
  return {
    command: `rg -n -i -m 4 --hidden --glob '!.git' --glob '!node_modules' --glob '!dist' ${shellQuote(pattern)} .`,
    description: 'Collect local read-only evidence',
    timeout: 8_000,
  }
}

function isSearchOrReadMcpTool(tool: Tool, query: string): boolean {
  const haystack = [
    tool.name,
    tool.searchHint,
    tool.mcpInfo?.serverName,
    tool.mcpInfo?.toolName,
  ]
    .filter(isString)
    .join(' ')
    .toLowerCase()
  if (
    /\b(search|read|list|find|query|lookup|issue|doc|resource)\b/.test(haystack)
  ) {
    return true
  }
  return queryTerms(query).some(term => haystack.includes(term.toLowerCase()))
}

function buildMcpSearchInput(
  tool: Tool,
  query: string,
): Record<string, unknown> | undefined {
  const properties = tool.inputJSONSchema?.properties
  const input: Record<string, unknown> = {}
  if (!properties || Object.keys(properties).length === 0) {
    return { query }
  }

  for (const key of Object.keys(properties)) {
    if (
      ['query', 'q', 'search', 'text', 'keyword', 'keywords'].includes(
        key.toLowerCase(),
      )
    ) {
      input[key] = query
    } else if (
      ['limit', 'maxresults', 'max_results'].includes(key.toLowerCase())
    ) {
      input[key] = 5
    }
  }

  return Object.keys(input).length > 0 ? input : undefined
}

function mcpToolResultText(data: unknown): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) {
    return data.map(mcpToolResultText).filter(Boolean).join('\n')
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const candidates = [
      record.text,
      record.content,
      record.result,
      record.results,
      record.items,
      record.data,
    ]
    const text = candidates.map(mcpToolResultText).filter(Boolean).join('\n')
    return text || JSON.stringify(data)
  }
  return ''
}

function mcpUrl(serverName?: string, toolName?: string): string | undefined {
  if (!serverName && !toolName) return undefined
  return `mcp://${serverName ?? 'unknown'}/${toolName ?? 'tool'}`
}

function resourceMatches(
  resource: { uri: string; name?: string; description?: string },
  query: string,
): boolean {
  const haystack = [resource.uri, resource.name, resource.description]
    .filter(isString)
    .join(' ')
    .toLowerCase()
  return queryTerms(query).some(term => haystack.includes(term.toLowerCase()))
}

function localCandidateFiles(query: string, limit: number): string[] {
  const candidates = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'package.json',
    'docs/testing-spec.md',
    'deepcode-deepseek-gap.html',
  ]
  const terms = queryTerms(query)
  return candidates
    .filter(file => {
      const lower = file.toLowerCase()
      return (
        terms.length === 0 ||
        terms.some(term => lower.includes(term.toLowerCase())) ||
        ['README.md', 'AGENTS.md', 'package.json'].includes(file)
      )
    })
    .slice(0, limit)
}

function summarizeFileContent(content: string, query: string): string {
  const terms = queryTerms(query)
  const lines = content.split(/\r?\n/)
  const matched = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      terms.some(term => line.toLowerCase().includes(term.toLowerCase())),
    )
    .slice(0, 8)
  const selected =
    matched.length > 0
      ? matched
      : lines
          .slice(0, Math.min(12, lines.length))
          .map((line, index) => ({ line, index }))
  return selected
    .map(({ line, index }) => `${index + 1}: ${line}`)
    .join('\n')
    .trim()
}

function queryTerms(query: string): string[] {
  return normalizeQuery(query)
    .split(/\s+/)
    .map(term => term.replace(/[^a-z0-9_\-/\u4e00-\u9fff]/gi, ''))
    .filter(term => term.length >= 3)
    .filter(
      term =>
        ![
          'the',
          'and',
          'for',
          'with',
          'from',
          'search',
          'local',
          'bash',
          'mcp',
        ].includes(term.toLowerCase()),
    )
    .slice(0, 8)
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}

function trimToBudget(content: string, maxCharacters?: number): string {
  const normalized = content.trim()
  if (!maxCharacters || normalized.length <= maxCharacters) return normalized
  return normalized.slice(0, Math.max(0, maxCharacters))
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath)
  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function isSourceEvidence(
  value: SourceEvidence | undefined,
): value is SourceEvidence {
  return value !== undefined
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const denyCanUseTool: CanUseToolFn = async () => ({
  behavior: 'deny',
  message: 'Agentic Search source runner does not delegate permission prompts.',
  decisionReason: {
    type: 'other',
    reason: 'Agentic Search source runner requires explicit permission.',
  },
})

function createAgenticSearchParentMessage(): AssistantMessage {
  return createAssistantMessage({
    content: 'Agentic Search source evidence collection',
    isVirtual: true,
  })
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}
