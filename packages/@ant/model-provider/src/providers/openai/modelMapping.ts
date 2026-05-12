/**
 * Default mapping from Anthropic model names to OpenAI model names.
 * Used only when ANTHROPIC_DEFAULT_*_MODEL env vars are not set.
 */
const DEFAULT_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'gpt-4o',
  'claude-sonnet-4-5-20250929': 'gpt-4o',
  'claude-sonnet-4-6': 'gpt-4o',
  'claude-opus-4-20250514': 'o3',
  'claude-opus-4-1-20250805': 'o3',
  'claude-opus-4-5-20251101': 'o3',
  'claude-opus-4-6': 'o3',
  'claude-haiku-4-5-20251001': 'gpt-4o-mini',
  'claude-3-5-haiku-20241022': 'gpt-4o-mini',
  'claude-3-7-sonnet-20250219': 'gpt-4o',
  'claude-3-5-sonnet-20241022': 'gpt-4o',
}

const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro'

function isDeepSeekEnvConfigured(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEY ||
      process.env.DEEPSEEK_BASE_URL ||
      process.env.DEEPSEEK_MODEL,
  )
}

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

/**
 * Resolve the OpenAI model name for a given Anthropic model.
 *
 * Priority:
 * 1. DEEPSEEK_MODEL env var (preferred DeepSeek entrypoint)
 * 2. OPENAI_MODEL env var (backward-compatible OpenAI-compatible entrypoint)
 * 3. DEEPSEEK_DEFAULT_{FAMILY}_MODEL env var (e.g. DEEPSEEK_DEFAULT_SONNET_MODEL)
 * 4. OPENAI_DEFAULT_{FAMILY}_MODEL env var
 * 5. ANTHROPIC_DEFAULT_{FAMILY}_MODEL env var (backward compatibility)
 * 6. DeepSeek default model when any DEEPSEEK_* env var is configured
 * 7. DEFAULT_MODEL_MAP lookup
 * 8. Pass through original model name
 */
export function resolveOpenAIModel(anthropicModel: string): string {
  if (process.env.DEEPSEEK_MODEL) {
    return process.env.DEEPSEEK_MODEL
  }

  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL
  }

  const cleanModel = anthropicModel.replace(/\[1m\]$/, '')

  const family = getModelFamily(cleanModel)
  if (family) {
    const deepSeekEnvVar = `DEEPSEEK_DEFAULT_${family.toUpperCase()}_MODEL`
    const deepSeekOverride = process.env[deepSeekEnvVar]
    if (deepSeekOverride) return deepSeekOverride

    const openaiEnvVar = `OPENAI_DEFAULT_${family.toUpperCase()}_MODEL`
    const openaiOverride = process.env[openaiEnvVar]
    if (openaiOverride) return openaiOverride

    const anthropicEnvVar = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
    const anthropicOverride = process.env[anthropicEnvVar]
    if (anthropicOverride) return anthropicOverride
  }

  if (isDeepSeekEnvConfigured()) {
    return DEEPSEEK_DEFAULT_MODEL
  }

  return DEFAULT_MODEL_MAP[cleanModel] ?? cleanModel
}
