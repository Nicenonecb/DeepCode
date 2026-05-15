import type { AssistantMessage, UserMessage } from '../../types/message.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
import {
  DEEPSEEK_V4_PRO_MODEL,
  getDeepSeekModelProfile,
  type DeepSeekEffortProfile,
} from './modelProfiles.js'

export type DeepSeekMaxPromptConflictPolicy = 'none' | 'concise-output'

export type DeepSeekMaxPromptPatchResult = {
  systemPrompt: SystemPrompt
  injected: boolean
  conflictPolicy: DeepSeekMaxPromptConflictPolicy
}

const DEEPSEEK_V4_PRO_MAX_PROMPT_PATCH = [
  'DeepSeek V4 Pro Max path is active.',
  'Use the extra reasoning budget to thoroughly decompose the task, pressure-test assumptions, list credible alternatives internally, and rule out false hypotheses before acting.',
  'Prefer production-ready, evidence-backed answers and code changes. Keep hidden reasoning private; expose only decisions, verification, and user-relevant tradeoffs.',
].join(' ')

const DEEPSEEK_V4_PRO_MAX_CONCISE_PROMPT_PATCH = [
  'DeepSeek V4 Pro Max path is active.',
  'Use the extra reasoning budget internally to decompose, pressure-test, compare alternatives, and rule out false hypotheses.',
  'The user requested concise output, so keep the final response short and action-oriented while preserving correctness and verification.',
].join(' ')

const CONCISE_REQUEST_PATTERN =
  /(?:简洁|简短|短答|只要|只给|直接给|不要解释|不用解释|别展开|一行|一句话|concise|brief|short answer|one[-\s]?liner|just (?:the )?(?:answer|command|diff)|no explanation|output only)/i

export function applyDeepSeekMaxPromptPatch(params: {
  model: string
  effortProfile?: DeepSeekEffortProfile
  enableThinking: boolean
  systemPrompt: SystemPrompt
  messages: readonly (AssistantMessage | UserMessage)[]
}): DeepSeekMaxPromptPatchResult {
  if (!shouldInjectDeepSeekMaxPrompt(params)) {
    return {
      systemPrompt: params.systemPrompt,
      injected: false,
      conflictPolicy: 'none',
    }
  }

  const conflictPolicy = userRequestedConciseOutput(params.messages)
    ? 'concise-output'
    : 'none'
  const patch =
    conflictPolicy === 'concise-output'
      ? DEEPSEEK_V4_PRO_MAX_CONCISE_PROMPT_PATCH
      : DEEPSEEK_V4_PRO_MAX_PROMPT_PATCH

  return {
    systemPrompt: asSystemPrompt([...params.systemPrompt, patch]),
    injected: true,
    conflictPolicy,
  }
}

function shouldInjectDeepSeekMaxPrompt(params: {
  model: string
  effortProfile?: DeepSeekEffortProfile
  enableThinking: boolean
}): boolean {
  if (!params.enableThinking) return false
  if (params.effortProfile?.tier !== 'max') return false
  if (!params.effortProfile.thinkingEnabled) return false
  return getDeepSeekModelProfile(params.model)?.id === DEEPSEEK_V4_PRO_MODEL
}

function userRequestedConciseOutput(
  messages: readonly (AssistantMessage | UserMessage)[],
): boolean {
  const text = extractLastUserText(messages)
  return CONCISE_REQUEST_PATTERN.test(text)
}

function extractLastUserText(
  messages: readonly (AssistantMessage | UserMessage)[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type !== 'user') continue
    return extractTextFromContent(extractUserMessageContent(message))
  }
  return ''
}

function extractUserMessageContent(message: UserMessage): unknown {
  const record = message as unknown as {
    content?: unknown
    message?: { content?: unknown }
  }
  return record.content ?? record.message?.content
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}
