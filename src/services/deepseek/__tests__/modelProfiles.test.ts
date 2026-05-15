import { describe, expect, test } from 'bun:test'
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_FAST_MODEL,
  DEEPSEEK_MODEL_PROFILES,
  getDeepSeekModelFamily,
  getDeepSeekModelProfile,
  getDeepSeekToolProtocolProfile,
  getDefaultDeepSeekModelForAnthropicModel,
  getDefaultDeepSeekModelForFamily,
  getDeepSeekThinkingDefault,
  resolveDeepSeekEffortProfile,
  resolveDeepSeekRequestEffortProfile,
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
    expect(profile.thinking.supportedEfforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(profile.thinking.effortProfiles?.['non-think']).toMatchObject({
      thinkingEnabled: false,
      maxOutputTokens: 16_000,
      maxReasoningTokens: 0,
      maxContextTokens: 64_000,
      contextWatermark: 0.2,
    })
    expect(profile.thinking.effortProfiles?.high).toMatchObject({
      thinkingEnabled: true,
      reasoningEffort: 'high',
      maxOutputTokens: 64_000,
      maxReasoningTokens: 64_000,
      maxContextTokens: 512_000,
      contextWatermark: 0.6,
    })
    expect(profile.thinking.effortProfiles?.max).toMatchObject({
      thinkingEnabled: true,
      reasoningEffort: 'max',
      maxOutputTokens: 384_000,
      maxReasoningTokens: 256_000,
      maxContextTokens: 800_000,
      contextWatermark: 0.8,
    })
    expect(profile.toolProtocol).toEqual({
      preferred: 'dsml',
      fallbacks: ['openai-tools'],
    })
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

  test('declares DSML as V4 Pro primary tool protocol with native fallback', () => {
    expect(getDeepSeekToolProtocolProfile('deepseek-v4-pro')).toEqual({
      preferred: 'dsml',
      fallbacks: ['openai-tools'],
    })
    expect(getDeepSeekToolProtocolProfile('deepseek-v4-flash')).toEqual({
      preferred: 'openai-tools',
      fallbacks: [],
    })
  })

  test('maps effort values through DeepSeek supported levels', () => {
    expect(resolveDeepSeekReasoningEffort('deepseek-v4-pro')).toBe('max')
    expect(resolveDeepSeekReasoningEffort('deepseek-v4-pro', 'xhigh')).toBe(
      'max',
    )
    expect(resolveDeepSeekReasoningEffort('deepseek-v4-pro', 'high')).toBe(
      'high',
    )
    expect(
      resolveDeepSeekReasoningEffort('deepseek-v4-pro', 'medium'),
    ).toBeUndefined()
    expect(
      resolveDeepSeekReasoningEffort('deepseek-v4-pro', 'low'),
    ).toBeUndefined()
    expect(resolveDeepSeekReasoningEffort('gpt-4o', 'max')).toBeUndefined()
  })

  test('maps V4 Pro effort values to per-effort request profiles', () => {
    expect(resolveDeepSeekEffortProfile('deepseek-v4-pro')?.tier).toBe('max')
    expect(
      resolveDeepSeekEffortProfile('deepseek-v4-pro', 'low'),
    ).toMatchObject({
      tier: 'non-think',
      thinkingEnabled: false,
      maxOutputTokens: 16_000,
      maxReasoningTokens: 0,
      maxContextTokens: 64_000,
      contextWatermark: 0.2,
    })
    expect(
      resolveDeepSeekEffortProfile('deepseek-v4-pro', 'medium'),
    ).toMatchObject({
      tier: 'non-think',
      thinkingEnabled: false,
      maxOutputTokens: 16_000,
      maxReasoningTokens: 0,
      maxContextTokens: 64_000,
      contextWatermark: 0.2,
    })
    expect(
      resolveDeepSeekEffortProfile('deepseek-v4-pro', 'high'),
    ).toMatchObject({
      tier: 'high',
      thinkingEnabled: true,
      reasoningEffort: 'high',
      maxOutputTokens: 64_000,
      maxReasoningTokens: 64_000,
      maxContextTokens: 512_000,
      contextWatermark: 0.6,
    })
    expect(
      resolveDeepSeekEffortProfile('deepseek-v4-pro', 'max'),
    ).toMatchObject({
      tier: 'max',
      thinkingEnabled: true,
      reasoningEffort: 'max',
      maxOutputTokens: 384_000,
      maxReasoningTokens: 256_000,
      maxContextTokens: 800_000,
      contextWatermark: 0.8,
    })
  })

  test('applies settings and env overrides to request effort budgets', () => {
    const originalMaxReasoning =
      process.env.DEEPSEEK_V4_PRO_MAX_MAX_REASONING_TOKENS
    process.env.DEEPSEEK_V4_PRO_MAX_MAX_REASONING_TOKENS = '128000'

    try {
      expect(
        resolveDeepSeekRequestEffortProfile('deepseek-v4-pro', 'high', {
          high: {
            maxOutputTokens: 32_000,
            maxContextTokens: 256_000,
            contextWatermark: 0.5,
          },
        }),
      ).toMatchObject({
        tier: 'high',
        maxOutputTokens: 32_000,
        maxReasoningTokens: 64_000,
        maxContextTokens: 256_000,
        contextWatermark: 0.5,
      })
      expect(
        resolveDeepSeekRequestEffortProfile('deepseek-v4-pro', 'max', {
          max: {
            maxReasoningTokens: 64_000,
          },
        }),
      ).toMatchObject({
        tier: 'max',
        maxReasoningTokens: 128_000,
      })
    } finally {
      if (originalMaxReasoning === undefined) {
        delete process.env.DEEPSEEK_V4_PRO_MAX_MAX_REASONING_TOKENS
      } else {
        process.env.DEEPSEEK_V4_PRO_MAX_MAX_REASONING_TOKENS =
          originalMaxReasoning
      }
    }
  })
})
