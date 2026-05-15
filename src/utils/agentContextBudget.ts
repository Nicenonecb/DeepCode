import { getContextWindowForModel } from './context.js'
import { getDeepSeekModelProfile } from '../services/deepseek/modelProfiles.js'

export type AgentContextCapTier = 'large' | 'standard'

export type AgentContextBudget = {
  capTokens: number
  parentContextTokens: number
  tier: AgentContextCapTier
  source: 'model-profile' | 'env'
}

const LARGE_AGENT_CONTEXT_CAP_TOKENS = 512_000
const STANDARD_AGENT_CONTEXT_CAP_TOKENS = 256_000

export function resolveAgentContextBudget(params: {
  parentModel: string
  agentType?: string
  description?: string
  prompt?: string
}): AgentContextBudget | undefined {
  const parentContextTokens = getContextWindowForModel(params.parentModel)
  if (!shouldCapAgentContext(params.parentModel, parentContextTokens)) {
    return undefined
  }

  const tier = resolveAgentContextCapTier(params)
  const envCap = parsePositiveIntegerEnv('DEEPSEEK_AGENT_CONTEXT_CAP_TOKENS')
  const defaultCap =
    tier === 'large'
      ? LARGE_AGENT_CONTEXT_CAP_TOKENS
      : STANDARD_AGENT_CONTEXT_CAP_TOKENS
  const capTokens = Math.min(parentContextTokens, envCap ?? defaultCap)

  return {
    capTokens,
    parentContextTokens,
    tier,
    source: envCap ? 'env' : 'model-profile',
  }
}

function shouldCapAgentContext(
  parentModel: string,
  parentContextTokens: number,
): boolean {
  if (parentContextTokens < 512_000) return false
  const deepSeekProfile = getDeepSeekModelProfile(parentModel)
  if ((deepSeekProfile?.contextWindowTokens ?? 0) >= 1_000_000) return true
  return /\[1m\]/i.test(parentModel)
}

function resolveAgentContextCapTier(params: {
  agentType?: string
  description?: string
  prompt?: string
}): AgentContextCapTier {
  const haystack = [
    params.agentType,
    params.description,
    params.prompt?.slice(0, 2_000),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  if (
    /large|long|complex|refactor|migration|multi[- ]?file|benchmark|deep|investigat|大|长|复杂|重构|迁移|多文件/.test(
      haystack,
    )
  ) {
    return 'large'
  }

  return 'standard'
}

function parsePositiveIntegerEnv(key: string): number | undefined {
  const raw = process.env[key]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : undefined
}
