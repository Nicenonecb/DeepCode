import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  hasDeepSeekConfig,
  hasDeepSeekEnv,
  hasOpenAICompatApiKey,
  resolveOpenAICompatEnv,
  resolveOpenAICompatModel,
} from '../env.js'
import {
  removeDeepSeekConfigForTesting,
  saveDeepSeekConfig,
} from '../../../deepseek/config.js'

describe('OpenAI-compatible env resolution', () => {
  const envKeys = [
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPSEEK_MODEL',
    'DEEPSEEK_DEFAULT_HAIKU_MODEL',
    'DEEPSEEK_DEFAULT_SONNET_MODEL',
    'DEEPSEEK_DEFAULT_OPUS_MODEL',
    'OPENAI_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
  ] as const
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    removeDeepSeekConfigForTesting()
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    removeDeepSeekConfigForTesting()
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  test('prefers DEEPSEEK_API_KEY over OPENAI_API_KEY', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
    process.env.OPENAI_API_KEY = 'sk-openai'
    process.env.OPENAI_BASE_URL = 'https://openai-compatible.example/v1'

    expect(resolveOpenAICompatEnv()).toEqual({
      apiKey: 'sk-deepseek',
      baseURL: DEEPSEEK_DEFAULT_BASE_URL,
    })
  })

  test('prefers locally saved DeepSeek config over environment variables', async () => {
    await saveDeepSeekConfig({
      apiKey: 'sk-local-deepseek',
      baseURL: 'https://local.deepseek.example/v1',
      model: 'deepseek-local',
    })
    process.env.DEEPSEEK_API_KEY = 'sk-env-deepseek'
    process.env.DEEPSEEK_BASE_URL = 'https://env.deepseek.example/v1'
    process.env.DEEPSEEK_MODEL = 'deepseek-env'

    expect(hasDeepSeekConfig()).toBe(true)
    expect(resolveOpenAICompatEnv()).toEqual({
      apiKey: 'sk-local-deepseek',
      baseURL: 'https://local.deepseek.example/v1',
    })
    expect(resolveOpenAICompatModel('claude-sonnet-4-6')).toBe('deepseek-local')
  })

  test('saved DeepSeek key uses default base URL and model', async () => {
    await saveDeepSeekConfig({ apiKey: 'sk-local-deepseek' })

    expect(hasOpenAICompatApiKey()).toBe(true)
    expect(resolveOpenAICompatEnv()).toEqual({
      apiKey: 'sk-local-deepseek',
      baseURL: DEEPSEEK_DEFAULT_BASE_URL,
    })
    expect(resolveOpenAICompatModel('claude-sonnet-4-6')).toBe(
      'deepseek-v4-pro',
    )
  })

  test('saved DeepSeek key uses the profile family default for Haiku', async () => {
    await saveDeepSeekConfig({ apiKey: 'sk-local-deepseek' })

    expect(resolveOpenAICompatModel('claude-haiku-4-5-20251001')).toBe(
      'deepseek-v4-flash',
    )
  })

  test('DEEPSEEK_API_KEY uses the profile family default for Haiku', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek'

    expect(resolveOpenAICompatModel('claude-haiku-4-5-20251001')).toBe(
      'deepseek-v4-flash',
    )
  })

  test('DEEPSEEK_DEFAULT_*_MODEL overrides profile family default', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
    process.env.DEEPSEEK_DEFAULT_HAIKU_MODEL = 'deepseek-custom-haiku'

    expect(resolveOpenAICompatModel('claude-haiku-4-5-20251001')).toBe(
      'deepseek-custom-haiku',
    )
  })

  test('base URL alone does not satisfy API key requirement', () => {
    process.env.DEEPSEEK_BASE_URL = 'https://gateway.example/v1'

    expect(hasDeepSeekConfig()).toBe(true)
    expect(hasOpenAICompatApiKey()).toBe(false)
  })

  test('uses DEEPSEEK_BASE_URL when provided', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
    process.env.DEEPSEEK_BASE_URL = 'https://gateway.example/v1'

    expect(resolveOpenAICompatEnv()).toEqual({
      apiKey: 'sk-deepseek',
      baseURL: 'https://gateway.example/v1',
    })
  })

  test('falls back to OPENAI_* when no DEEPSEEK_* env is set', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'
    process.env.OPENAI_BASE_URL = 'https://openai-compatible.example/v1'

    expect(hasDeepSeekEnv()).toBe(false)
    expect(resolveOpenAICompatEnv()).toEqual({
      apiKey: 'sk-openai',
      baseURL: 'https://openai-compatible.example/v1',
    })
  })
})
