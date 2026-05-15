import { describe, expect, test } from 'bun:test'
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_FAST_MODEL,
  DEEPSEEK_MODEL_PROFILES,
  getDeepSeekModelFamily,
  getDeepSeekModelProfile,
  getDefaultDeepSeekModelForAnthropicModel,
  getDefaultDeepSeekModelForFamily,
  getDeepSeekThinkingDefault,
  resolveDeepSeekReasoningEffort,
} from '../modelProfiles.js'

describe('DeepSeek model profiles', () => {
  test('declares the default and fast models', () => {
    expect(DEEPSEEK_DEFAULT_MODEL).toBe('deepseek-v4-pro')
    expect(DEEPSEEK_FAST_MODEL).toBe('deepseek-v4-flash')
  })

  test('declares V4 Pro capabilities and promo pricing', () => {
    const profile = DEEPSEEK_MODEL_PROFILES['deepseek-v4-pro']

    expect(profile.contextWindowTokens).toBe(1_000_000)
    expect(profile.maxOutputTokens).toBe(384_000)
    expect(profile.thinking.defaultEnabled).toBe(true)
    expect(profile.thinking.defaultEffort).toBe('max')
    expect(profile.toolProtocol).toBe('openai-tools')
    expect(profile.pricing).toMatchObject({
      inputCacheHit: 0.003625,
      inputCacheMiss: 0.435,
      output: 0.87,
    })
  })

  test('declares V4 Flash as the haiku/fast default', () => {
    const profile = DEEPSEEK_MODEL_PROFILES['deepseek-v4-flash']

    expect(profile.contextWindowTokens).toBe(1_000_000)
    expect(profile.maxOutputTokens).toBe(384_000)
    expect(profile.defaultStrategy.useForFastMode).toBe(true)
    expect(getDefaultDeepSeekModelForFamily('haiku')).toBe('deepseek-v4-flash')
  })

  test('maps Anthropic families to profile defaults', () => {
    expect(getDeepSeekModelFamily('claude-haiku-4-5-20251001')).toBe('haiku')
    expect(
      getDefaultDeepSeekModelForAnthropicModel('claude-haiku-4-5-20251001'),
    ).toBe('deepseek-v4-flash')
    expect(getDefaultDeepSeekModelForAnthropicModel('claude-sonnet-4-6')).toBe(
      'deepseek-v4-pro',
    )
    expect(getDefaultDeepSeekModelForAnthropicModel('claude-opus-4-6')).toBe(
      'deepseek-v4-pro',
    )
  })

  test('declares V3.2 legacy context and thinking budget', () => {
    const profile = DEEPSEEK_MODEL_PROFILES['deepseek-v3.2']

    expect(profile.contextWindowTokens).toBe(64_000)
    expect(profile.maxCoTTokens).toBe(32_000)
    expect(profile.maxOutputTokens).toBe(8_000)
  })

  test('resolves compatibility aliases through the profile table', () => {
    expect(getDeepSeekModelProfile('gateway/deepseek-chat')?.id).toBe(
      'deepseek-v4-flash',
    )
    expect(getDeepSeekThinkingDefault('deepseek-chat')).toBe(false)
    expect(getDeepSeekThinkingDefault('deepseek-reasoner')).toBe(true)
  })

  test('maps effort values through DeepSeek supported levels', () => {
    expect(resolveDeepSeekReasoningEffort('deepseek-v4-pro')).toBe('max')
    expect(resolveDeepSeekReasoningEffort('deepseek-v4-pro', 'xhigh')).toBe(
      'max',
    )
    expect(resolveDeepSeekReasoningEffort('deepseek-v4-pro', 'medium')).toBe(
      'high',
    )
    expect(resolveDeepSeekReasoningEffort('gpt-4o', 'max')).toBeUndefined()
  })
})
