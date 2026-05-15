import type { AssistantMessage, UserMessage } from '../types/message.js'

export type InterleavedThinkingRetentionMode = 'tool-chain' | 'conversation'

export type InterleavedThinkingRetentionOptions = {
  mode?: InterleavedThinkingRetentionMode
  keepRecentAssistantTurns?: number
  maxReasoningChars?: number
}

export type InterleavedThinkingRetentionDecision = {
  preserveThinking: boolean
  reason: 'tool-chain' | 'recent-conversation' | 'disabled'
}

const DEFAULT_RECENT_ASSISTANT_TURNS = 1
const DEFAULT_MAX_REASONING_CHARS = 12_000

export function createInterleavedThinkingRetentionState(
  messages: readonly (UserMessage | AssistantMessage)[],
  options: InterleavedThinkingRetentionOptions = {},
): Map<AssistantMessage, InterleavedThinkingRetentionDecision> {
  const mode = options.mode ?? 'conversation'
  const keepRecentAssistantTurns =
    mode === 'conversation'
      ? Math.max(
          0,
          options.keepRecentAssistantTurns ?? DEFAULT_RECENT_ASSISTANT_TURNS,
        )
      : 0
  const assistantMessages = messages.filter(isAssistantMessage)
  const recentAssistantMessages = new Set(
    assistantMessages.slice(-keepRecentAssistantTurns),
  )
  const toolChainAssistantMessages = findToolChainAssistantMessages(messages)
  const decisions = new Map<
    AssistantMessage,
    InterleavedThinkingRetentionDecision
  >()

  for (const message of assistantMessages) {
    if (toolChainAssistantMessages.has(message)) {
      decisions.set(message, { preserveThinking: true, reason: 'tool-chain' })
    } else if (recentAssistantMessages.has(message)) {
      decisions.set(message, {
        preserveThinking: true,
        reason: 'recent-conversation',
      })
    } else {
      decisions.set(message, { preserveThinking: false, reason: 'disabled' })
    }
  }

  return decisions
}

export function shouldPreserveThinkingForMessage(
  decisions: Map<AssistantMessage, InterleavedThinkingRetentionDecision>,
  message: AssistantMessage,
): InterleavedThinkingRetentionDecision {
  return (
    decisions.get(message) ?? { preserveThinking: false, reason: 'disabled' }
  )
}

export function trimReasoningContent(
  reasoningContent: string,
  options: InterleavedThinkingRetentionOptions = {},
): string {
  const maxChars = Math.max(
    0,
    options.maxReasoningChars ?? DEFAULT_MAX_REASONING_CHARS,
  )
  if (maxChars === 0 || reasoningContent.length <= maxChars) {
    return reasoningContent
  }
  return reasoningContent.slice(reasoningContent.length - maxChars)
}

function findToolChainAssistantMessages(
  messages: readonly (UserMessage | AssistantMessage)[],
): Set<AssistantMessage> {
  const assistantByToolUseId = new Map<string, AssistantMessage>()
  const toolChainAssistantMessages = new Set<AssistantMessage>()

  for (const message of messages) {
    if (message.type === 'assistant') {
      for (const toolUseId of getAssistantToolUseIds(message)) {
        assistantByToolUseId.set(toolUseId, message)
      }
      continue
    }

    for (const toolResultId of getUserToolResultIds(message)) {
      const assistant = assistantByToolUseId.get(toolResultId)
      if (assistant) toolChainAssistantMessages.add(assistant)
    }
  }

  return toolChainAssistantMessages
}

function isAssistantMessage(
  message: UserMessage | AssistantMessage,
): message is AssistantMessage {
  return message.type === 'assistant'
}

function getAssistantToolUseIds(message: AssistantMessage): string[] {
  const content = message.message.content
  if (!Array.isArray(content)) return []
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return undefined
      const record = block as unknown as Record<string, unknown>
      return record.type === 'tool_use' && typeof record.id === 'string'
        ? record.id
        : undefined
    })
    .filter((id): id is string => Boolean(id))
}

function getUserToolResultIds(message: UserMessage): string[] {
  const content = message.message.content
  if (!Array.isArray(content)) return []
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return undefined
      const record = block as unknown as Record<string, unknown>
      return record.type === 'tool_result' &&
        typeof record.tool_use_id === 'string'
        ? record.tool_use_id
        : undefined
    })
    .filter((id): id is string => Boolean(id))
}
