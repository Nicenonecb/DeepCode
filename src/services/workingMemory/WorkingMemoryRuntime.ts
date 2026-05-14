import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getProjectRoot, getSessionId } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import type {
  Message,
  SystemCompactBoundaryMessage,
} from '../../types/message.js'
import type { VerificationSummary } from '../verification/index.js'
import {
  createWorkingMemory,
  serializeWorkingMemory,
  trimWorkingMemory,
  updateWorkingMemory,
  type WorkingMemory,
  type WorkingMemoryPatch,
} from './WorkingMemoryStore.js'
import { summarizeWorkingMemory } from './WorkingMemorySummarizer.js'

export type WorkingMemorySettings = {
  enabled?: boolean
  maxChars?: number
  includeInPrompt?: boolean
  persistToDisk?: boolean
}

export type WorkingMemoryPersistenceOptions = {
  sessionPath?: string
  projectPath?: string
}

const DEFAULT_MAX_CHARS = 12_000
const WORKING_MEMORY_DIR = 'working-memory'
const PROJECT_WORKING_MEMORY_PATH = join('.deepcode', 'working-memory.json')

export function normalizeWorkingMemorySettings(
  settings: WorkingMemorySettings | undefined,
): Required<WorkingMemorySettings> {
  return {
    enabled: settings?.enabled === true,
    maxChars: normalizeMaxChars(settings?.maxChars),
    includeInPrompt: settings?.includeInPrompt !== false,
    persistToDisk: settings?.persistToDisk === true,
  }
}

export function shouldUseWorkingMemory(
  settings: WorkingMemorySettings | undefined,
): boolean {
  return normalizeWorkingMemorySettings(settings).enabled
}

export function createWorkingMemoryPrompt(
  memory: WorkingMemory | undefined,
  settings: WorkingMemorySettings | undefined,
): string | undefined {
  const normalized = normalizeWorkingMemorySettings(settings)
  if (!normalized.enabled || !normalized.includeInPrompt || !memory) {
    return undefined
  }

  const serialized = serializeWorkingMemory(memory, {
    maxChars: normalized.maxChars,
  })
  if (!serialized.text.trim()) return undefined

  return [
    '<working_memory>',
    'Use this structured memory as continuity context. Prefer the latest user request when it conflicts with older memory.',
    serialized.text,
    '</working_memory>',
  ].join('\n')
}

export function updateWorkingMemoryForMessages(
  memory: WorkingMemory | undefined,
  messages: Message[],
  settings: WorkingMemorySettings | undefined,
): WorkingMemory | undefined {
  if (!shouldUseWorkingMemory(settings)) return memory
  return applyWorkingMemoryPatch(
    memory,
    summarizeWorkingMemory({ messages }),
    settings,
  )
}

export function updateWorkingMemoryForVerification(
  memory: WorkingMemory | undefined,
  verificationSummary: VerificationSummary,
  settings: WorkingMemorySettings | undefined,
): WorkingMemory | undefined {
  if (!shouldUseWorkingMemory(settings)) return memory
  return applyWorkingMemoryPatch(
    memory,
    summarizeWorkingMemory({ verificationSummary }),
    settings,
  )
}

export function applyWorkingMemoryPatch(
  memory: WorkingMemory | undefined,
  patch: WorkingMemoryPatch,
  settings: WorkingMemorySettings | undefined,
): WorkingMemory {
  const normalized = normalizeWorkingMemorySettings(settings)
  const base = memory ?? createWorkingMemory(undefined, patch.updatedAt)
  return trimWorkingMemory(
    updateWorkingMemory(base, patch, { now: patch.updatedAt }),
    normalized.maxChars,
  )
}

export function loadPersistedWorkingMemory(
  settings: WorkingMemorySettings | undefined,
): WorkingMemory | undefined {
  const normalized = normalizeWorkingMemorySettings(settings)
  if (!normalized.enabled || !normalized.persistToDisk) return undefined

  const projectMemory = readWorkingMemoryFile(
    getProjectWorkingMemoryPath(),
    normalized.maxChars,
  )
  if (projectMemory) return projectMemory

  return readWorkingMemoryFile(getWorkingMemoryPath(), normalized.maxChars)
}

export function persistWorkingMemory(
  memory: WorkingMemory | undefined,
  settings: WorkingMemorySettings | undefined,
  options: WorkingMemoryPersistenceOptions = {},
): void {
  const normalized = normalizeWorkingMemorySettings(settings)
  if (!normalized.enabled || !normalized.persistToDisk || !memory) return

  writeWorkingMemoryFile(options.sessionPath ?? getWorkingMemoryPath(), memory)
  writeWorkingMemoryFile(
    options.projectPath ?? getProjectWorkingMemoryPath(),
    memory,
  )
}

export function getWorkingMemoryPath(): string {
  return join(
    getClaudeConfigHomeDir(),
    WORKING_MEMORY_DIR,
    `${getSessionId()}.json`,
  )
}

export function getProjectWorkingMemoryPath(): string {
  return join(getProjectRoot(), PROJECT_WORKING_MEMORY_PATH)
}

export function attachWorkingMemoryCheckpoint(
  boundary: SystemCompactBoundaryMessage,
  memory: WorkingMemory | undefined,
  settings: WorkingMemorySettings | undefined,
): SystemCompactBoundaryMessage {
  const normalized = normalizeWorkingMemorySettings(settings)
  if (!normalized.enabled || !memory) return boundary

  return {
    ...boundary,
    compactMetadata: {
      ...boundary.compactMetadata,
      workingMemoryCheckpoint: trimWorkingMemory(memory, normalized.maxChars),
    },
  }
}

export function getLatestWorkingMemoryCheckpoint(
  messages: readonly Message[],
  settings: WorkingMemorySettings | undefined,
): WorkingMemory | undefined {
  const normalized = normalizeWorkingMemorySettings(settings)
  if (!normalized.enabled) return undefined

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.type !== 'system') continue
    const compactMetadata = (message as SystemCompactBoundaryMessage)
      .compactMetadata
    const checkpoint = compactMetadata?.workingMemoryCheckpoint
    if (isWorkingMemoryRecord(checkpoint)) {
      return trimWorkingMemory(checkpoint, normalized.maxChars)
    }
  }

  return undefined
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (!Number.isFinite(maxChars) || maxChars === undefined) {
    return DEFAULT_MAX_CHARS
  }
  return Math.max(1, Math.floor(maxChars))
}

function readWorkingMemoryFile(
  path: string,
  maxChars: number,
): WorkingMemory | undefined {
  if (!existsSync(path)) return undefined

  try {
    const parsed = jsonParse(readFileSync(path, 'utf8')) as unknown
    if (!isWorkingMemoryRecord(parsed)) return undefined
    return trimWorkingMemory(parsed, maxChars)
  } catch (error) {
    logForDebugging(
      `[WorkingMemory] Failed to load ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

function writeWorkingMemoryFile(path: string, memory: WorkingMemory): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${jsonStringify(memory, null, 2)}\n`)
  } catch (error) {
    logForDebugging(
      `[WorkingMemory] Failed to persist ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function isWorkingMemoryRecord(value: unknown): value is WorkingMemory {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as WorkingMemory).facts) &&
    Array.isArray((value as WorkingMemory).rejectedHypotheses) &&
    Array.isArray((value as WorkingMemory).changedFiles) &&
    Array.isArray((value as WorkingMemory).commands) &&
    Array.isArray((value as WorkingMemory).nextSteps) &&
    typeof (value as WorkingMemory).updatedAt === 'number'
  )
}
