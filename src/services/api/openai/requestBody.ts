/**
 * Pure utility functions for building OpenAI request bodies and detecting
 * thinking mode. Extracted from index.ts so tests can import them without
 * triggering heavy module side-effects (OpenAI client, stream adapter, etc.).
 */
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.mjs'
import {
  getDeepSeekThinkingDefault,
  resolveDeepSeekEffortProfile,
  resolveDeepSeekRequestEffortProfile,
  resolveDeepSeekReasoningEffort,
  type DeepSeekEffortBudgetSettings,
} from '../../deepseek/modelProfiles.js'
import { isEnvTruthy, isEnvDefinedFalsy } from '../../../utils/envUtils.js'

/**
 * Detect whether DeepSeek-style thinking mode should be enabled.
 *
 * Enabled when:
 * 1. OPENAI_ENABLE_THINKING=1 is set (explicit enable), OR
 * 2. DeepSeek per-effort profile enables thinking, OR
 * 3. DeepSeek model profile declares thinking on by default
 *
 * Disabled when:
 * - OPENAI_ENABLE_THINKING=0/false/no/off is explicitly set (overrides model detection)
 *
 * @param model - The resolved OpenAI model name
 */
export function isOpenAIThinkingEnabled(
  model: string,
  effortValue?: unknown,
): boolean {
  // Explicit disable takes priority (overrides model auto-detect)
  if (isEnvDefinedFalsy(process.env.OPENAI_ENABLE_THINKING)) return false
  // Explicit enable
  if (isEnvTruthy(process.env.OPENAI_ENABLE_THINKING)) return true
  // Explicit effort should decide the DeepSeek V4 Pro tier. Low/medium are
  // true non-think tiers, not aliases for high reasoning.
  if (effortValue !== undefined) {
    const effortProfile = resolveDeepSeekEffortProfile(model, effortValue)
    if (effortProfile) return effortProfile.thinkingEnabled
  }
  // Auto-detect from the DeepSeek model profile.
  return getDeepSeekThinkingDefault(model)
}

/**
 * Resolve max output tokens for the OpenAI-compatible path.
 *
 * Override priority:
 * 1. maxOutputTokensOverride (programmatic, from query pipeline)
 * 2. OPENAI_MAX_TOKENS env var (OpenAI-specific, useful for local models
 *    with small context windows, e.g. RTX 3060 12GB running 65536-token models)
 * 3. CLAUDE_CODE_MAX_OUTPUT_TOKENS env var (generic override)
 * 4. upperLimit default (64000)
 */
export function resolveOpenAIMaxTokens(
  upperLimit: number,
  maxOutputTokensOverride?: number,
): number {
  return (
    maxOutputTokensOverride ??
    (process.env.OPENAI_MAX_TOKENS
      ? parseInt(process.env.OPENAI_MAX_TOKENS, 10) || undefined
      : undefined) ??
    (process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
      ? parseInt(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, 10) || undefined
      : undefined) ??
    upperLimit
  )
}

/**
 * Build the request body for OpenAI chat.completions.create().
 * Extracted for testability — the thinking mode params are injected here.
 *
 * DeepSeek thinking mode: inject thinking params via request body.
 * Two formats are added simultaneously to support different deployments:
 * - Official DeepSeek API: `thinking: { type: 'enabled' }`
 * - Self-hosted DeepSeek-V3.2: `enable_thinking: true` + `chat_template_kwargs: { thinking: true }`
 * OpenAI SDK passes unknown keys through to the HTTP body.
 * Each endpoint will use the format it recognizes and ignore the others.
 */
export function buildOpenAIRequestBody(params: {
  model: string
  messages: any[]
  tools: any[]
  toolChoice: any
  enableThinking: boolean
  maxTokens: number
  temperatureOverride?: number
  effortValue?: unknown
  effortBudgetSettings?: DeepSeekEffortBudgetSettings
}): Omit<ChatCompletionCreateParamsStreaming, 'reasoning_effort'> & {
  thinking?: { type: string }
  reasoning_effort?: 'high' | 'max'
  enable_thinking?: boolean
  chat_template_kwargs?: { thinking: boolean }
} {
  const {
    model,
    messages,
    tools,
    toolChoice,
    enableThinking,
    maxTokens,
    temperatureOverride,
  } = params
  const effortProfile = resolveDeepSeekRequestEffortProfile(
    model,
    params.effortValue,
    params.effortBudgetSettings,
  )
  const effectiveThinking =
    enableThinking && (effortProfile?.thinkingEnabled ?? true)
  const effectiveMaxTokens = effortProfile
    ? Math.min(maxTokens, effortProfile.maxOutputTokens)
    : maxTokens
  const reasoningEffort = effectiveThinking
    ? resolveDeepSeekReasoningEffort(model, params.effortValue)
    : undefined
  return {
    model,
    messages,
    max_tokens: effectiveMaxTokens,
    ...(tools.length > 0 && {
      tools,
      ...(toolChoice && { tool_choice: toolChoice }),
    }),
    stream: true,
    stream_options: { include_usage: true },
    // DeepSeek thinking mode: enable chain-of-thought output.
    // When active, temperature/top_p/presence_penalty/frequency_penalty are ignored by DeepSeek.
    ...(effectiveThinking && {
      // Official DeepSeek API format
      thinking: { type: 'enabled' },
      ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      // Self-hosted DeepSeek-V3.2 format
      enable_thinking: true,
      chat_template_kwargs: { thinking: true },
    }),
    // Only send temperature when thinking mode is off (DeepSeek ignores it anyway,
    // but other providers may respect it)
    ...(!effectiveThinking &&
      temperatureOverride !== undefined && {
        temperature: temperatureOverride,
      }),
  }
}
