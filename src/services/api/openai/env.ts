import { resolveOpenAIModel } from '@ant/model-provider'
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  getStoredDeepSeekConfig,
  hasStoredDeepSeekApiKey,
  hasStoredDeepSeekConfig,
} from '../../deepseek/config.js'

export { DEEPSEEK_DEFAULT_BASE_URL }

export function hasDeepSeekEnv(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEY ||
      process.env.DEEPSEEK_BASE_URL ||
      process.env.DEEPSEEK_MODEL,
  )
}

export function hasDeepSeekConfig(): boolean {
  return hasStoredDeepSeekConfig() || hasDeepSeekEnv()
}

export function hasOpenAICompatApiKey(): boolean {
  return Boolean(
    hasStoredDeepSeekApiKey() ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY,
  )
}

export function resolveOpenAICompatEnv(): {
  apiKey: string
  baseURL?: string
} {
  const stored = getStoredDeepSeekConfig()
  const deepSeekConfigured = hasDeepSeekConfig()
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY || undefined
  const openAIApiKey = process.env.OPENAI_API_KEY || undefined
  const deepSeekBaseURL = process.env.DEEPSEEK_BASE_URL || undefined
  const openAIBaseURL = process.env.OPENAI_BASE_URL || undefined

  return {
    apiKey: stored.apiKey ?? deepSeekApiKey ?? openAIApiKey ?? '',
    baseURL:
      stored.baseURL ??
      deepSeekBaseURL ??
      (deepSeekConfigured ? DEEPSEEK_DEFAULT_BASE_URL : openAIBaseURL),
  }
}

export function resolveOpenAICompatModel(anthropicModel: string): string {
  const stored = getStoredDeepSeekConfig()
  if (stored.model) return stored.model
  if (stored.apiKey || stored.baseURL) return DEEPSEEK_DEFAULT_MODEL
  return resolveOpenAIModel(anthropicModel)
}
