import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  resetStateForTests,
  setProjectRoot,
  switchSession,
} from '../../../bootstrap/state.js'
import {
  attachWorkingMemoryCheckpoint,
  createWorkingMemory,
  createWorkingMemoryPrompt,
  getLatestWorkingMemoryCheckpoint,
  normalizeWorkingMemorySettings,
  persistWorkingMemory,
  updateWorkingMemoryForMessages,
} from '../index.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import {
  cleanupTempDir,
  createTempDir,
} from '../../../../tests/mocks/file-system.js'

let tempDir = ''
let previousConfigDir: string | undefined

beforeEach(async () => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  tempDir = await createTempDir('working-memory-runtime-')
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, 'config')
  resetStateForTests()
  setProjectRoot(tempDir)
  switchSession('11111111-1111-4111-8111-111111111111' as never)
})

afterEach(async () => {
  resetStateForTests()
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  if (tempDir) {
    await cleanupTempDir(tempDir)
  }
})

describe('WorkingMemoryRuntime', () => {
  test('normalizes settings with safe defaults', () => {
    expect(normalizeWorkingMemorySettings(undefined)).toEqual({
      enabled: false,
      maxChars: 12000,
      includeInPrompt: true,
      persistToDisk: false,
    })
    expect(
      normalizeWorkingMemorySettings({
        enabled: true,
        maxChars: 20,
        includeInPrompt: false,
        persistToDisk: true,
      }),
    ).toEqual({
      enabled: true,
      maxChars: 20,
      includeInPrompt: false,
      persistToDisk: true,
    })
  })

  test('renders model-readable prompt only when enabled and included', () => {
    const memory = createWorkingMemory(
      {
        goal: 'Finish WorkingMemory query integration',
        nextSteps: ['Run typecheck'],
      },
      100,
    )

    expect(
      createWorkingMemoryPrompt(memory, {
        enabled: false,
      }),
    ).toBeUndefined()
    expect(
      createWorkingMemoryPrompt(memory, {
        enabled: true,
        includeInPrompt: false,
      }),
    ).toBeUndefined()

    const prompt = createWorkingMemoryPrompt(memory, {
      enabled: true,
      maxChars: 1000,
    })

    expect(prompt).toContain('<working_memory>')
    expect(prompt).toContain('Finish WorkingMemory query integration')
    expect(prompt).toContain('Run typecheck')
  })

  test('updates from messages when enabled and leaves memory untouched when disabled', () => {
    const messages = [
      createUserMessage({
        content: 'Wire WorkingMemory into QueryEngine.',
      }),
    ]

    expect(
      updateWorkingMemoryForMessages(undefined, messages, {
        enabled: false,
      }),
    ).toBeUndefined()

    const memory = updateWorkingMemoryForMessages(undefined, messages, {
      enabled: true,
    })

    expect(memory?.goal).toBe('Wire WorkingMemory into QueryEngine.')
  })

  test('persists project-level memory when disk persistence is enabled', () => {
    const memory = createWorkingMemory(
      {
        goal: 'Persist project checkpoint',
      },
      123,
    )
    const sessionPath = join(tempDir, 'session-memory.json')
    const projectPath = join(
      tempDir,
      'project',
      '.deepcode',
      'working-memory.json',
    )

    persistWorkingMemory(
      memory,
      {
        enabled: true,
        persistToDisk: true,
      },
      {
        sessionPath,
        projectPath,
      },
    )

    expect(existsSync(sessionPath)).toBe(true)
    expect(existsSync(projectPath)).toBe(true)
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).goal).toBe(
      'Persist project checkpoint',
    )
  })

  test('attaches and restores compact boundary checkpoints', () => {
    const memory = createWorkingMemory(
      {
        goal: 'Keep this through compact',
        verificationStatus: {
          status: 'failed',
          summary: 'typecheck failed',
        },
      },
      123,
    )
    const boundary = attachWorkingMemoryCheckpoint(
      createCompactBoundaryMessage('manual', 100),
      memory,
      {
        enabled: true,
        maxChars: 500,
      },
    )

    expect(boundary.compactMetadata.workingMemoryCheckpoint).toMatchObject({
      goal: 'Keep this through compact',
    })
    expect(
      getLatestWorkingMemoryCheckpoint([boundary], {
        enabled: true,
        maxChars: 500,
      })?.verificationStatus,
    ).toMatchObject({
      status: 'failed',
      summary: 'typecheck failed',
    })
  })
})
