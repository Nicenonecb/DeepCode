import type { EffortLevel } from '../../entrypoints/sdk/runtimeTypes.js'

export type DeepSeekModelId =
  | 'deepseek-v4-pro'
  | 'deepseek-v4-flash'
  | 'deepseek-v3.2'

export type DeepSeekToolProtocol = 'dsml' | 'openai-tools'

export type DeepSeekToolProtocolProfile = {
  preferred: DeepSeekToolProtocol
  fallbacks: readonly DeepSeekToolProtocol[]
}

export type DeepSeekThinkingMode = {
  supported: boolean
  defaultEnabled: boolean
  defaultEffort?: Extract<EffortLevel, 'high' | 'max'>
  supportedEfforts: readonly Extract<EffortLevel, 'high' | 'max'>[]
}

export type DeepSeekPricing = {
  currency: 'USD'
  unit: 'MTok'
  inputCacheHit: number
  inputCacheMiss: number
  output: number
  undiscounted?: {
    inputCacheHit?: number
    inputCacheMiss?: number
    output?: number
  }
  note?: string
}

export type DeepSeekDefaultStrategy = {
  useForMainLoop: boolean
  useForFastMode: boolean
  familyDefaults: readonly ('haiku' | 'sonnet' | 'opus')[]
}

export type DeepSeekModelFamily = 'haiku' | 'sonnet' | 'opus'

export type DeepSeekModelProfile = {
  id: DeepSeekModelId
  displayName: string
  aliases: readonly string[]
  contextWindowTokens: number
  maxOutputTokens: number
  maxCoTTokens?: number
  thinking: DeepSeekThinkingMode
  toolProtocol: DeepSeekToolProtocolProfile
  pricing: DeepSeekPricing
  defaultStrategy: DeepSeekDefaultStrategy
}

export const DEEPSEEK_V4_PRO_MODEL: DeepSeekModelId = 'deepseek-v4-pro'
export const DEEPSEEK_V4_FLASH_MODEL: DeepSeekModelId = 'deepseek-v4-flash'
export const DEEPSEEK_V3_2_MODEL: DeepSeekModelId = 'deepseek-v3.2'

export const DEEPSEEK_DEFAULT_MODEL = DEEPSEEK_V4_PRO_MODEL
export const DEEPSEEK_FAST_MODEL = DEEPSEEK_V4_FLASH_MODEL

export const DEEPSEEK_MODEL_PROFILES: Record<
  DeepSeekModelId,
  DeepSeekModelProfile
> = {
  [DEEPSEEK_V4_PRO_MODEL]: {
    id: DEEPSEEK_V4_PRO_MODEL,
    displayName: 'DeepSeek V4 Pro',
    aliases: [
      'deepseek-v4-pro',
      'deepseek-v4-pro-preview',
      'deepseek-v4-preview',
    ],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    thinking: {
      supported: true,
      defaultEnabled: true,
      defaultEffort: 'max',
      supportedEfforts: ['high', 'max'],
    },
    toolProtocol: {
      preferred: 'dsml',
      fallbacks: ['openai-tools'],
    },
    pricing: {
      currency: 'USD',
      unit: 'MTok',
      inputCacheHit: 0.003625,
      inputCacheMiss: 0.435,
      output: 0.87,
      undiscounted: {
        inputCacheHit: 0.0145,
        inputCacheMiss: 1.74,
        output: 3.48,
      },
      note: 'DeepSeek lists V4 Pro at a 75% discount through 2026-05-31 15:59 UTC.',
    },
    defaultStrategy: {
      useForMainLoop: true,
      useForFastMode: false,
      familyDefaults: ['sonnet', 'opus'],
    },
  },
  [DEEPSEEK_V4_FLASH_MODEL]: {
    id: DEEPSEEK_V4_FLASH_MODEL,
    displayName: 'DeepSeek V4 Flash',
    aliases: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    thinking: {
      supported: true,
      defaultEnabled: false,
      defaultEffort: 'high',
      supportedEfforts: ['high', 'max'],
    },
    toolProtocol: {
      preferred: 'openai-tools',
      fallbacks: [],
    },
    pricing: {
      currency: 'USD',
      unit: 'MTok',
      inputCacheHit: 0.0028,
      inputCacheMiss: 0.14,
      output: 0.28,
    },
    defaultStrategy: {
      useForMainLoop: false,
      useForFastMode: true,
      familyDefaults: ['haiku'],
    },
  },
  [DEEPSEEK_V3_2_MODEL]: {
    id: DEEPSEEK_V3_2_MODEL,
    displayName: 'DeepSeek V3.2',
    aliases: [
      'deepseek-v3.2',
      'deepseek-v3_2',
      'deepseek-v32',
      'deepseek-v3.2-exp',
    ],
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_000,
    maxCoTTokens: 32_000,
    thinking: {
      supported: true,
      defaultEnabled: true,
      defaultEffort: 'high',
      supportedEfforts: ['high', 'max'],
    },
    toolProtocol: {
      preferred: 'openai-tools',
      fallbacks: [],
    },
    pricing: {
      currency: 'USD',
      unit: 'MTok',
      inputCacheHit: 0.14,
      inputCacheMiss: 0.55,
      output: 2.19,
      note: 'Legacy V3.2-compatible pricing mirrors the older reasoner tier.',
    },
    defaultStrategy: {
      useForMainLoop: false,
      useForFastMode: false,
      familyDefaults: [],
    },
  },
} as const

type AliasMatch = {
  profile: DeepSeekModelProfile
  alias: string
}

const PROFILE_ALIAS_MATCHERS: AliasMatch[] = Object.values(
  DEEPSEEK_MODEL_PROFILES,
)
  .flatMap(profile =>
    profile.aliases.map(alias => ({
      profile,
      alias,
    })),
  )
  .sort((a, b) => b.alias.length - a.alias.length)

export function getDeepSeekModelProfile(
  model: string,
): DeepSeekModelProfile | undefined {
  return findDeepSeekModelAlias(model)?.profile
}

export function findDeepSeekModelAlias(model: string): AliasMatch | undefined {
  const normalized = model.toLowerCase()
  if (!normalized) return undefined

  return PROFILE_ALIAS_MATCHERS.find(({ alias }) => normalized.includes(alias))
}

export function getDefaultDeepSeekModelForFamily(
  family: DeepSeekModelFamily | null,
): DeepSeekModelId {
  if (!family) return DEEPSEEK_DEFAULT_MODEL

  const profile = Object.values(DEEPSEEK_MODEL_PROFILES).find(p =>
    p.defaultStrategy.familyDefaults.includes(family),
  )
  return profile?.id ?? DEEPSEEK_DEFAULT_MODEL
}

export function getDeepSeekModelFamily(
  model: string,
): DeepSeekModelFamily | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

export function getDefaultDeepSeekModelForAnthropicModel(
  anthropicModel: string,
): DeepSeekModelId {
  return getDefaultDeepSeekModelForFamily(
    getDeepSeekModelFamily(anthropicModel),
  )
}

export function getDeepSeekThinkingDefault(model: string): boolean {
  const match = findDeepSeekModelAlias(model)
  if (!match) return false

  // Compatibility aliases are mode selectors for V4 Flash.
  if (match.alias === 'deepseek-chat') return false
  if (match.alias === 'deepseek-reasoner') return true

  return match.profile.thinking.defaultEnabled
}

export function getDeepSeekToolProtocolProfile(
  model: string,
): DeepSeekToolProtocolProfile | undefined {
  return getDeepSeekModelProfile(model)?.toolProtocol
}

export function resolveDeepSeekReasoningEffort(
  model: string,
  effortValue?: unknown,
): 'high' | 'max' | undefined {
  const profile = getDeepSeekModelProfile(model)
  if (!profile?.thinking.supported) return undefined

  if (effortValue === 'max' || effortValue === 'xhigh') return 'max'
  if (
    effortValue === 'low' ||
    effortValue === 'medium' ||
    effortValue === 'high' ||
    typeof effortValue === 'number'
  ) {
    return 'high'
  }

  return profile.thinking.defaultEffort
}
