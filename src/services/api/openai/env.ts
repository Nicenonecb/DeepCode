export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

export function hasDeepSeekEnv(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEY ||
      process.env.DEEPSEEK_BASE_URL ||
      process.env.DEEPSEEK_MODEL,
  )
}

export function resolveOpenAICompatEnv(): {
  apiKey: string
  baseURL?: string
} {
  const deepSeekConfigured = hasDeepSeekEnv()
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY || undefined
  const openAIApiKey = process.env.OPENAI_API_KEY || undefined
  const deepSeekBaseURL = process.env.DEEPSEEK_BASE_URL || undefined
  const openAIBaseURL = process.env.OPENAI_BASE_URL || undefined

  return {
    apiKey: deepSeekApiKey ?? openAIApiKey ?? '',
    baseURL:
      deepSeekBaseURL ??
      (deepSeekConfigured ? DEEPSEEK_DEFAULT_BASE_URL : openAIBaseURL),
  }
}
