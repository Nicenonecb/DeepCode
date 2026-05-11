import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  hasDeepSeekEnv,
  resolveOpenAICompatEnv,
} from '../env.js'

describe('OpenAI-compatible env resolution', () => {
  const envKeys = [
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPSEEK_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
  ] as const
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
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
