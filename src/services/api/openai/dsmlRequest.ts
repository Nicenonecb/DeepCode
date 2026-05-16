import {
  buildDSMLToolSchemaPrompt,
  type DSMLGatewaySettings,
} from '../../dsml/index.js'
import { DEEPSEEK_DEFAULT_BASE_URL } from '../../deepseek/config.js'
import {
  getDeepSeekModelProfile,
  type DeepSeekModelId,
  type DeepSeekToolProtocol,
} from '../../deepseek/modelProfiles.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../../utils/envUtils.js'

type DSMLToolSchema = Record<string, unknown>

export type DSMLGatewayFallbackReason =
  | 'settings-disabled'
  | 'env-disabled'
  | 'explicit-opt-in-required'
  | 'model-prefers-openai-tools'
  | 'provider-not-verified'
  | 'prompt-empty'

export type DSMLGatewayDecisionSource =
  | 'settings'
  | 'env'
  | 'deepseek-profile'
  | 'fallback'

export type DSMLGatewayProviderEvidence =
  | 'official-deepseek'
  | 'custom-deepseek-compatible'
  | 'openai-compatible'

export type DSMLGatewayDecision = {
  toolProtocol: DeepSeekToolProtocol
  enabled: boolean
  source: DSMLGatewayDecisionSource
  fallbackReason?: DSMLGatewayFallbackReason
  modelProfileId?: DeepSeekModelId
  providerEvidence: DSMLGatewayProviderEvidence
  preferredProtocol?: DeepSeekToolProtocol
  fallbackProtocols: readonly DeepSeekToolProtocol[]
}

export type DSMLRequestGatewayResult<TMessage, TToolChoice> = {
  messages: TMessage[]
  tools: unknown[]
  toolChoice: TToolChoice | undefined
  enabled: boolean
  decision: DSMLGatewayDecision
  metrics: {
    toolProtocol: DeepSeekToolProtocol
    standardToolCount: number
    nativeToolCount: number
    promptChars: number
    fallbackReason?: DSMLGatewayFallbackReason
    providerEvidence: DSMLGatewayProviderEvidence
  }
}

export function applyDSMLRequestGateway<TMessage, TToolChoice>(params: {
  model: string
  baseURL?: string
  messages: TMessage[]
  standardTools: DSMLToolSchema[]
  nativeTools: unknown[]
  nativeToolChoice: TToolChoice | undefined
  settings: DSMLGatewaySettings | undefined
  createMetaMessage: (content: string) => TMessage
}): DSMLRequestGatewayResult<TMessage, TToolChoice> {
  const decision = resolveDSMLGatewayDecision({
    model: params.model,
    baseURL: params.baseURL,
    settings: params.settings,
  })

  if (!decision.enabled) {
    return {
      messages: params.messages,
      tools: params.nativeTools,
      toolChoice: params.nativeToolChoice,
      enabled: false,
      decision,
      metrics: buildRequestMetrics(decision, params, 0),
    }
  }

  const prompt = buildDSMLToolSchemaPrompt(params.standardTools, {
    ...params.settings,
    enabled: true,
  })

  if (!prompt) {
    const promptEmptyDecision: DSMLGatewayDecision = {
      ...decision,
      enabled: false,
      toolProtocol: 'openai-tools',
      source: 'fallback',
      fallbackReason: 'prompt-empty',
    }
    return {
      messages: params.messages,
      tools: params.nativeTools,
      toolChoice: params.nativeToolChoice,
      enabled: false,
      decision: promptEmptyDecision,
      metrics: buildRequestMetrics(promptEmptyDecision, params, 0),
    }
  }

  return {
    messages: [params.createMetaMessage(prompt), ...params.messages],
    tools: [],
    toolChoice: undefined,
    enabled: true,
    decision,
    metrics: buildRequestMetrics(decision, params, prompt.length),
  }
}

export function resolveDSMLGatewayDecision(params: {
  model: string
  baseURL?: string
  settings?: DSMLGatewaySettings
}): DSMLGatewayDecision {
  const profile = getDeepSeekModelProfile(params.model)
  const providerEvidence = getDSMLProviderEvidence(params.baseURL)
  const fallbackProtocols = profile?.toolProtocol.fallbacks ?? []

  if (params.settings?.enabled === false) {
    return {
      toolProtocol: 'openai-tools',
      enabled: false,
      source: 'settings',
      fallbackReason: 'settings-disabled',
      modelProfileId: profile?.id,
      providerEvidence,
      preferredProtocol: profile?.toolProtocol.preferred,
      fallbackProtocols,
    }
  }

  if (isEnvDefinedFalsy(process.env.DEEPSEEK_DSML_GATEWAY)) {
    return {
      toolProtocol: 'openai-tools',
      enabled: false,
      source: 'env',
      fallbackReason: 'env-disabled',
      modelProfileId: profile?.id,
      providerEvidence,
      preferredProtocol: profile?.toolProtocol.preferred,
      fallbackProtocols,
    }
  }

  if (
    params.settings?.enabled === true ||
    isEnvTruthy(process.env.DEEPSEEK_DSML_GATEWAY)
  ) {
    return {
      toolProtocol: 'dsml',
      enabled: true,
      source: params.settings?.enabled === true ? 'settings' : 'env',
      modelProfileId: profile?.id,
      providerEvidence,
      preferredProtocol: profile?.toolProtocol.preferred,
      fallbackProtocols,
    }
  }

  if (profile?.toolProtocol.preferred === 'dsml') {
    if (providerEvidence !== 'official-deepseek') {
      return {
        toolProtocol: 'openai-tools',
        enabled: false,
        source: 'fallback',
        fallbackReason: 'provider-not-verified',
        modelProfileId: profile.id,
        providerEvidence,
        preferredProtocol: profile.toolProtocol.preferred,
        fallbackProtocols,
      }
    }
    return {
      toolProtocol: 'openai-tools',
      enabled: false,
      source: 'fallback',
      fallbackReason: 'explicit-opt-in-required',
      modelProfileId: profile?.id,
      providerEvidence,
      preferredProtocol: profile?.toolProtocol.preferred,
      fallbackProtocols,
    }
  }

  if (profile) {
    return {
      toolProtocol: 'openai-tools',
      enabled: false,
      source: 'fallback',
      fallbackReason: 'model-prefers-openai-tools',
      modelProfileId: profile?.id,
      providerEvidence,
      preferredProtocol: profile?.toolProtocol.preferred,
      fallbackProtocols,
    }
  }

  return {
    toolProtocol: 'openai-tools',
    enabled: false,
    source: 'fallback',
    fallbackReason: 'provider-not-verified',
    providerEvidence,
    fallbackProtocols,
  }
}

export function getDSMLProviderEvidence(
  baseURL: string | undefined,
): DSMLGatewayProviderEvidence {
  if (isOfficialDeepSeekBaseURL(baseURL)) return 'official-deepseek'
  if (baseURL && /deepseek/i.test(baseURL)) return 'custom-deepseek-compatible'
  return 'openai-compatible'
}

function isOfficialDeepSeekBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) return false
  const normalized = baseURL.replace(/\/+$/, '').toLowerCase()
  const official = DEEPSEEK_DEFAULT_BASE_URL.replace(/\/+$/, '').toLowerCase()
  return normalized === official || normalized === official.replace(/\/v1$/, '')
}

function buildRequestMetrics<TMessage, TToolChoice>(
  decision: DSMLGatewayDecision,
  params: {
    standardTools: DSMLToolSchema[]
    nativeTools: unknown[]
  },
  promptChars: number,
): DSMLRequestGatewayResult<TMessage, TToolChoice>['metrics'] {
  return {
    toolProtocol: decision.toolProtocol,
    standardToolCount: params.standardTools.length,
    nativeToolCount: params.nativeTools.length,
    promptChars,
    fallbackReason: decision.fallbackReason,
    providerEvidence: decision.providerEvidence,
  }
}
