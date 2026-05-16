import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  createAssistantMessage,
  getUserMessageText,
} from '../../utils/messages.js'
import { getCwd } from '../../utils/cwd.js'
import {
  createAgenticSearchPlan,
  shouldUseAgenticSearch,
} from './AgenticSearchPlanner.js'
import { runAgenticSearchPlan } from './AgenticSearchExecutor.js'
import { createAgenticSearchEvidencePackIntegration } from './AgenticSearchEvidencePack.js'
import { createAgenticSearchWebToolAdapters } from './WebToolAdapters.js'
import { createAgenticSearchSourceRunner } from './SourceRunnerAdapters.js'
import type {
  AgenticSearchEffort,
  AgenticSearchEvidencePackIntegration,
  AgenticSearchExecutionMetrics,
  AgenticSearchExecutionResult,
} from './types.js'

export type AgenticSearchLiveSettings = {
  enabled?: boolean
  mode?: 'off' | 'injected-pack' | 'live'
  effort?: AgenticSearchEffort
  maxEvidenceChars?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
  preferredSources?: (
    | 'web_search'
    | 'web_fetch'
    | 'mcp_search'
    | 'local_search'
    | 'bash_search'
  )[]
  evidencePack?: {
    text?: string
    metadata?: Record<string, unknown>
  }
}

export type AgenticSearchLiveRun = {
  result: AgenticSearchExecutionResult
  integration: AgenticSearchEvidencePackIntegration
  metrics: AgenticSearchExecutionMetrics
}

export type AgenticSearchLiveOptions = {
  messages: Message[]
  settings: AgenticSearchLiveSettings | undefined
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  now?: () => number
}

export async function runLiveAgenticSearchIfNeeded({
  messages,
  settings,
  toolUseContext,
  canUseTool,
  now,
}: AgenticSearchLiveOptions): Promise<AgenticSearchLiveRun | undefined> {
  const task = latestNonMetaUserPrompt(messages)
  if (!shouldRunLiveAgenticSearch(settings, task, toolUseContext)) {
    return undefined
  }

  const parentMessage = createAssistantMessage({
    content: 'Agentic Search live evidence collection',
    isVirtual: true,
  })
  const plan = createAgenticSearchPlan({
    task,
    effort: settings?.effort,
    allowedDomains: settings?.allowedDomains,
    blockedDomains: settings?.blockedDomains,
    preferredSources: settings?.preferredSources,
    ...(now ? { now: now() } : {}),
  })
  const webAdapters = createAgenticSearchWebToolAdapters({
    toolUseContext,
    canUseTool,
    parentMessage,
    askPolicy: 'delegate',
    now,
  })
  const result = await runAgenticSearchPlan(plan, {
    ...webAdapters,
    sourceRunner: createAgenticSearchSourceRunner({
      toolUseContext,
      canUseTool,
      parentMessage,
      cwd: getCwd(),
      bashAskPolicy: 'delegate',
      now,
    }),
  })
  const integration = createAgenticSearchEvidencePackIntegration({
    plan,
    pack: result.evidencePack,
    target: 'query_loop',
  })

  return {
    result,
    integration,
    metrics: result.metrics,
  }
}

export function shouldRunLiveAgenticSearch(
  settings: AgenticSearchLiveSettings | undefined,
  task: string | undefined,
  toolUseContext: ToolUseContext,
): task is string {
  if (!settings?.enabled || settings.mode !== 'live') return false
  if (!task?.trim()) return false
  if (toolUseContext.agentId) return false
  if (!shouldUseAgenticSearch(task)) return false
  return true
}

function latestNonMetaUserPrompt(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.type !== 'user' || message.isMeta) continue
    const text = getUserMessageText(message)
    if (text?.trim()) return text.trim()
  }
  return undefined
}
