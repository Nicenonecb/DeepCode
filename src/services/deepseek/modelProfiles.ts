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

export type DeepSeekReasoningEffort = 'high' | 'max'

export type DeepSeekEffortTier = 'non-think' | 'high' | 'max'

export type DeepSeekEffortProfile = {
  tier: DeepSeekEffortTier
  thinkingEnabled: boolean
  reasoningEffort?: DeepSeekReasoningEffort
  maxOutputTokens: number
  maxReasoningTokens: number
  maxContextTokens: number
  contextWatermark: number
  defaultUseCase: string
}

export type DeepSeekEffortBudgetOverride = {
  maxOutputTokens?: number
  maxReasoningTokens?: number
  maxContextTokens?: number
  contextWatermark?: number
}

export type DeepSeekEffortBudgetSettings = Partial<
  Record<DeepSeekEffortTier | 'nonThink', DeepSeekEffortBudgetOverride>
>

export type DeepSeekThinkingMode = {
  supported: boolean
  defaultEnabled: boolean
  defaultEffort?: EffortLevel
  supportedEfforts: readonly EffortLevel[]
  effortProfiles?: Partial<Record<DeepSeekEffortTier, DeepSeekEffortProfile>>
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
      supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      effortProfiles: {
        'non-think': {
          tier: 'non-think',
          thinkingEnabled: false,
          maxOutputTokens: 16_000,
          maxReasoningTokens: 0,
          maxContextTokens: 64_000,
          contextWatermark: 0.2,
          defaultUseCase:
            'Small edits, direct command answers, concise chat, and tasks where the user explicitly asks for low or medium effort.',
        },
        high: {
          tier: 'high',
          thinkingEnabled: true,
          reasoningEffort: 'high',
          maxOutputTokens: 64_000,
          maxReasoningTokens: 64_000,
          maxContextTokens: 512_000,
          contextWatermark: 0.6,
          defaultUseCase:
            'Normal coding turns, tool planning, debugging, and multi-file work that needs reasoning without the full Max budget.',
        },
        max: {
          tier: 'max',
          thinkingEnabled: true,
          reasoningEffort: 'max',
          maxOutputTokens: 384_000,
          maxReasoningTokens: 256_000,
          maxContextTokens: 800_000,
          contextWatermark: 0.8,
          defaultUseCase:
            'Large refactors, ambiguous investigations, deep design work, long-context synthesis, and explicit Max requests.',
        },
      },
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

function resolveDeepSeekEffortTier(
  profile: DeepSeekModelProfile,
  effortValue?: unknown,
): DeepSeekEffortTier | undefined {
  if (effortValue === 'low' || effortValue === 'medium') return 'non-think'
  if (effortValue === 'high' || typeof effortValue === 'number') return 'high'
  if (effortValue === 'max' || effortValue === 'xhigh') return 'max'

  const defaultEffort = profile.thinking.defaultEffort
  if (defaultEffort === 'low' || defaultEffort === 'medium') {
    return 'non-think'
  }
  if (defaultEffort === 'high') return 'high'
  if (defaultEffort === 'max' || defaultEffort === 'xhigh') return 'max'

  return profile.thinking.defaultEnabled ? 'high' : 'non-think'
}

export function resolveDeepSeekEffortProfile(
  model: string,
  effortValue?: unknown,
): DeepSeekEffortProfile | undefined {
  const profile = getDeepSeekModelProfile(model)
  if (!profile?.thinking.supported) return undefined

  const effortProfiles = profile.thinking.effortProfiles
  if (!effortProfiles) return undefined

  const tier = resolveDeepSeekEffortTier(profile, effortValue)
  return tier ? effortProfiles[tier] : undefined
}

export function resolveDeepSeekRequestEffortProfile(
  model: string,
  effortValue?: unknown,
  budgetSettings?: DeepSeekEffortBudgetSettings,
): DeepSeekEffortProfile | undefined {
  const profile = resolveDeepSeekEffortProfile(model, effortValue)
  if (!profile) return undefined

  const override = {
    ...getSettingsBudgetOverride(profile.tier, budgetSettings),
    ...getEnvBudgetOverride(profile.tier),
  }

  return applyBudgetOverride(profile, override)
}

function getSettingsBudgetOverride(
  tier: DeepSeekEffortTier,
  budgetSettings?: DeepSeekEffortBudgetSettings,
): DeepSeekEffortBudgetOverride {
  if (!budgetSettings) return {}
  return {
    ...(tier === 'non-think' ? budgetSettings.nonThink : undefined),
    ...budgetSettings[tier],
  }
}

function getEnvBudgetOverride(
  tier: DeepSeekEffortTier,
): DeepSeekEffortBudgetOverride {
  const prefixByTier: Record<DeepSeekEffortTier, string> = {
    'non-think': 'DEEPSEEK_V4_PRO_NON_THINK',
    high: 'DEEPSEEK_V4_PRO_HIGH',
    max: 'DEEPSEEK_V4_PRO_MAX',
  }
  const prefix = prefixByTier[tier]
  return compactBudgetOverride({
    maxOutputTokens: parsePositiveIntegerEnv(`${prefix}_MAX_OUTPUT_TOKENS`),
    maxReasoningTokens: parseNonNegativeIntegerEnv(
      `${prefix}_MAX_REASONING_TOKENS`,
    ),
    maxContextTokens: parsePositiveIntegerEnv(`${prefix}_MAX_CONTEXT_TOKENS`),
    contextWatermark: parseWatermarkEnv(`${prefix}_CONTEXT_WATERMARK`),
  })
}

function compactBudgetOverride(
  override: DeepSeekEffortBudgetOverride,
): DeepSeekEffortBudgetOverride {
  return Object.fromEntries(
    Object.entries(override).filter(([, value]) => value !== undefined),
  ) as DeepSeekEffortBudgetOverride
}

function applyBudgetOverride(
  profile: DeepSeekEffortProfile,
  override: DeepSeekEffortBudgetOverride,
): DeepSeekEffortProfile {
  const maxOutputTokens =
    positiveIntegerOrUndefined(override.maxOutputTokens) ??
    profile.maxOutputTokens
  const maxReasoningTokens =
    nonNegativeIntegerOrUndefined(override.maxReasoningTokens) ??
    profile.maxReasoningTokens
  const maxContextTokens =
    positiveIntegerOrUndefined(override.maxContextTokens) ??
    profile.maxContextTokens
  const contextWatermark =
    watermarkOrUndefined(override.contextWatermark) ?? profile.contextWatermark

  return {
    ...profile,
    maxOutputTokens,
    maxReasoningTokens,
    maxContextTokens,
    contextWatermark,
  }
}

function parsePositiveIntegerEnv(key: string): number | undefined {
  return positiveIntegerOrUndefined(parseEnvNumber(key))
}

function parseNonNegativeIntegerEnv(key: string): number | undefined {
  return nonNegativeIntegerOrUndefined(parseEnvNumber(key))
}

function parseWatermarkEnv(key: string): number | undefined {
  return watermarkOrUndefined(parseEnvNumber(key))
}

function parseEnvNumber(key: string): number | undefined {
  const rawValue = process.env[key]
  if (!rawValue) return undefined
  const value = Number(rawValue)
  return Number.isFinite(value) ? value : undefined
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function nonNegativeIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function watermarkOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 && value <= 1
    ? value
    : undefined
}

function toDeepSeekReasoningEffort(
  effort?: unknown,
): DeepSeekReasoningEffort | undefined {
  if (effort === 'max' || effort === 'xhigh') return 'max'
  if (effort === 'high' || typeof effort === 'number') return 'high'
  return undefined
}

export function resolveDeepSeekReasoningEffort(
  model: string,
  effortValue?: unknown,
): DeepSeekReasoningEffort | undefined {
  const effortProfile = resolveDeepSeekEffortProfile(model, effortValue)
  if (effortProfile) return effortProfile.reasoningEffort

  const profile = getDeepSeekModelProfile(model)
  if (!profile?.thinking.supported) return undefined

  return (
    toDeepSeekReasoningEffort(effortValue) ??
    toDeepSeekReasoningEffort(profile.thinking.defaultEffort)
  )
}
