import { promises as fs } from 'fs'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import { logError } from '../../utils/log.js'
import { DEEPSEEK_DEFAULT_MODEL } from './modelProfiles.js'

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
export { DEEPSEEK_DEFAULT_MODEL }

const MIN_API_KEY_LENGTH = 8
const MAX_API_KEY_LENGTH = 512

export interface StoredDeepSeekConfig {
  apiKey?: string
  baseURL?: string
  model?: string
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function getStoredDeepSeekConfig(): StoredDeepSeekConfig {
  const config = getGlobalConfig()
  return {
    apiKey: clean(config.deepSeekApiKey),
    baseURL: clean(config.deepSeekBaseUrl),
    model: clean(config.deepSeekModel),
  }
}

export function hasStoredDeepSeekConfig(): boolean {
  const config = getStoredDeepSeekConfig()
  return Boolean(config.apiKey || config.baseURL || config.model)
}

export function hasStoredDeepSeekApiKey(): boolean {
  return Boolean(getStoredDeepSeekConfig().apiKey)
}

export async function saveDeepSeekConfig(input: {
  apiKey: string
  baseURL?: string
  model?: string
}): Promise<void> {
  const apiKey = input.apiKey.trim()
  if (apiKey.length < MIN_API_KEY_LENGTH) {
    throw new Error(
      `DeepSeek API Key is too short (${apiKey.length}/${MIN_API_KEY_LENGTH} chars minimum).`,
    )
  }
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error(
      `DeepSeek API Key is too long (${apiKey.length}/${MAX_API_KEY_LENGTH} chars maximum).`,
    )
  }

  const baseURL = clean(input.baseURL)
  if (baseURL) {
    try {
      new URL(baseURL)
    } catch {
      throw new Error('DeepSeek Base URL must be a valid URL.')
    }
  }

  saveGlobalConfig(current => ({
    ...current,
    deepSeekApiKey: apiKey,
    deepSeekBaseUrl: baseURL,
    deepSeekModel: clean(input.model),
  }))

  if (process.env.NODE_ENV !== 'test') {
    await tryChmod600()
  }
}

export function removeDeepSeekConfigForTesting(): void {
  saveGlobalConfig(current => ({
    ...current,
    deepSeekApiKey: undefined,
    deepSeekBaseUrl: undefined,
    deepSeekModel: undefined,
  }))
}

function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/sk-\S*/g, '[REDACTED]')
  }
  return 'unknown error'
}

async function tryChmod600(): Promise<void> {
  if (process.platform === 'win32') return
  try {
    await fs.chmod(getGlobalClaudeFile(), 0o600)
  } catch (err: unknown) {
    logError(
      new Error(
        `[saveDeepSeekConfig] Could not set chmod 600 on ${getGlobalClaudeFile()}: ${sanitizeErrorMessage(err)}`,
      ),
    )
  }
}
