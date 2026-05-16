import type { AssistantMessage } from '../../types/message.js'
import {
  WebFetchTool,
  type Output as WebFetchOutput,
} from '@deepcode/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import { createAdapter as createWebSearchAdapter } from '@deepcode/builtin-tools/tools/WebSearchTool/adapters/index.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { createAssistantMessage } from '../../utils/messages.js'
import type { PermissionDecision } from '../../types/permissions.js'
import type {
  AgenticSearchExecutorAdapters,
  AgenticSearchWebFetchRequest,
  AgenticSearchWebFetchResponse,
  AgenticSearchWebSearchRequest,
  AgenticSearchWebSearchResponse,
} from './types.js'

type WebFetchToolInput = {
  url: string
  prompt: string
}

type WebFetchToolRuntime = Tool<typeof WebFetchTool.inputSchema, WebFetchOutput>

export type AgenticSearchWebToolAdapterOptions = {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  parentMessage?: AssistantMessage
  askPolicy?: 'deny' | 'delegate'
  webSearch?: AgenticSearchExecutorAdapters['webSearch']
  webFetch?: AgenticSearchExecutorAdapters['webFetch']
  webFetchToolCall?: (
    input: WebFetchToolInput,
  ) => Promise<{ data: WebFetchOutput }>
  now?: () => number
}

export function createAgenticSearchWebToolAdapters({
  toolUseContext,
  canUseTool,
  parentMessage,
  askPolicy,
  webSearch,
  webFetch,
  webFetchToolCall,
  now,
}: AgenticSearchWebToolAdapterOptions): AgenticSearchExecutorAdapters {
  return {
    webSearch: webSearch ?? createWebSearchToolAdapter(toolUseContext),
    webFetch:
      webFetch ??
      createWebFetchToolAdapter({
        toolUseContext,
        canUseTool,
        parentMessage: parentMessage ?? createAgenticSearchParentMessage(),
        askPolicy,
        webFetchToolCall,
      }),
    ...(now ? { now } : {}),
  }
}

export function createWebSearchToolAdapter(
  toolUseContext: ToolUseContext,
): AgenticSearchExecutorAdapters['webSearch'] {
  return async (
    request: AgenticSearchWebSearchRequest,
  ): Promise<AgenticSearchWebSearchResponse> => {
    const adapter = createWebSearchAdapter()
    const hits = await adapter.search(request.query, {
      allowedDomains: request.allowedDomains,
      blockedDomains: request.blockedDomains,
      numResults: request.numResults,
      livecrawl: request.livecrawl,
      searchType: request.searchType,
      contextMaxCharacters: request.contextMaxCharacters,
      signal: toolUseContext.abortController.signal,
    })

    return {
      hits: hits.map(hit => ({
        title: hit.title,
        url: hit.url,
        ...(hit.snippet ? { snippet: hit.snippet } : {}),
      })),
    }
  }
}

export function createWebFetchToolAdapter({
  toolUseContext,
  canUseTool,
  parentMessage,
  askPolicy = 'deny',
  webFetchToolCall,
}: {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  parentMessage: AssistantMessage
  askPolicy?: 'deny' | 'delegate'
  webFetchToolCall?: (
    input: WebFetchToolInput,
  ) => Promise<{ data: WebFetchOutput }>
}): AgenticSearchExecutorAdapters['webFetch'] {
  return async request => {
    const input = {
      url: request.url,
      prompt: request.prompt,
    }
    const webFetchTool = WebFetchTool as WebFetchToolRuntime
    const parsedInput = webFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      throw new Error(
        `WebFetch input validation failed: ${parsedInput.error.message}`,
      )
    }

    const validation = await webFetchTool.validateInput?.(
      parsedInput.data,
      toolUseContext,
    )
    if (validation?.result === false) {
      throw new Error(validation.message)
    }

    const permission = await webFetchTool.checkPermissions(
      parsedInput.data,
      toolUseContext,
    )
    const toolUseID = toolUseIdFor(request)
    const decision = await resolveWebFetchPermission({
      permission,
      canUseTool,
      webFetchTool,
      input: parsedInput.data,
      toolUseContext,
      parentMessage,
      toolUseID,
      askPolicy,
    })

    if (decision.behavior !== 'allow') {
      throw new Error(decision.message || 'WebFetch permission denied.')
    }

    return normalizeWebFetchOutput(
      await (webFetchToolCall
        ? webFetchToolCall(decision.updatedInput ?? parsedInput.data)
        : webFetchTool.call(
            decision.updatedInput ?? parsedInput.data,
            toolUseContext,
            canUseTool,
            parentMessage,
          )),
    )
  }
}

export function normalizeWebFetchOutput({
  data,
}: {
  data: WebFetchOutput
}): AgenticSearchWebFetchResponse {
  return {
    content: data.result,
    title: titleFromUrl(data.url),
    durationMs: data.durationMs,
  }
}

async function resolveWebFetchPermission({
  permission,
  canUseTool,
  webFetchTool,
  input,
  toolUseContext,
  parentMessage,
  toolUseID,
  askPolicy,
}: {
  permission: Awaited<ReturnType<WebFetchToolRuntime['checkPermissions']>>
  canUseTool: CanUseToolFn
  webFetchTool: WebFetchToolRuntime
  input: WebFetchToolInput
  toolUseContext: ToolUseContext
  parentMessage: AssistantMessage
  toolUseID: string
  askPolicy: 'deny' | 'delegate'
}): Promise<PermissionDecision<WebFetchToolInput>> {
  if (permission.behavior === 'allow' || permission.behavior === 'deny') {
    return permission as PermissionDecision<WebFetchToolInput>
  }
  if (permission.behavior === 'ask' && askPolicy === 'deny') {
    return {
      behavior: 'deny',
      message: permission.message,
      decisionReason: {
        type: 'other',
        reason: 'Agentic Search requires explicit WebFetch permission.',
      },
    }
  }

  return (await canUseTool(
    webFetchTool,
    input,
    toolUseContext,
    parentMessage,
    toolUseID,
    permission.behavior === 'ask' ? permission : undefined,
  )) as PermissionDecision<WebFetchToolInput>
}

function createAgenticSearchParentMessage(): AssistantMessage {
  return createAssistantMessage({
    content: 'Agentic Search evidence collection',
    isVirtual: true,
  })
}

function toolUseIdFor(request: AgenticSearchWebFetchRequest): string {
  return `agentic-search-webfetch-${stableHash(request.url).toString(36)}`
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}
