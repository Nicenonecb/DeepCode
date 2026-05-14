import { describe, expect, test } from 'bun:test'
import {
  WorkingMemoryStore,
  createWorkingMemory,
  mergeWorkingMemory,
  serializeWorkingMemory,
  trimWorkingMemory,
  updateWorkingMemory,
} from '../WorkingMemoryStore.js'

describe('WorkingMemoryStore', () => {
  test('creates an empty structured memory', () => {
    expect(createWorkingMemory(undefined, 123)).toEqual({
      facts: [],
      rejectedHypotheses: [],
      changedFiles: [],
      commands: [],
      nextSteps: [],
      updatedAt: 123,
    })
  })

  test('updates goal, facts, rejected hypotheses, changed files, commands, verification, and next steps', () => {
    const memory = createWorkingMemory(undefined, 100)
    const updated = updateWorkingMemory(
      memory,
      {
        goal: ' Fix parser failures ',
        facts: [
          'Parser accepts empty input',
          {
            text: 'Token stream is generated before parse',
            source: 'src/parser.ts',
          },
        ],
        rejectedHypotheses: ['The lexer is not the failing layer'],
        changedFiles: [
          'src/parser.ts',
          { path: 'src/parser.test.ts', reason: 'failing test' },
        ],
        commands: [
          {
            command: 'bun test src/parser.test.ts',
            status: 'failed',
            exitCode: 1,
            durationMs: 42,
            summary: 'parser > rejects bad input failed',
          },
        ],
        verificationStatus: {
          status: 'failed',
          command: 'bun test src/parser.test.ts',
          summary: '1 failing test',
        },
        nextSteps: ['Fix parse error branch'],
      },
      { now: 200 },
    )

    expect(updated.goal).toBe('Fix parser failures')
    expect(updated.facts).toEqual([
      {
        text: 'Parser accepts empty input',
        updatedAt: 200,
      },
      {
        text: 'Token stream is generated before parse',
        source: 'src/parser.ts',
        updatedAt: 200,
      },
    ])
    expect(updated.rejectedHypotheses[0]?.text).toBe(
      'The lexer is not the failing layer',
    )
    expect(updated.changedFiles).toEqual([
      {
        path: 'src/parser.ts',
        updatedAt: 200,
      },
      {
        path: 'src/parser.test.ts',
        reason: 'failing test',
        updatedAt: 200,
      },
    ])
    expect(updated.commands[0]).toMatchObject({
      command: 'bun test src/parser.test.ts',
      status: 'failed',
      exitCode: 1,
      durationMs: 42,
    })
    expect(updated.verificationStatus).toEqual({
      status: 'failed',
      command: 'bun test src/parser.test.ts',
      summary: '1 failing test',
      updatedAt: 200,
    })
    expect(updated.nextSteps[0]?.text).toBe('Fix parse error branch')
  })

  test('merges and deduplicates memory patches', () => {
    const base = createWorkingMemory(
      {
        goal: 'Fix parser',
        facts: ['Parser fails on malformed input'],
        changedFiles: [{ path: 'src/parser.ts', reason: 'implementation' }],
        commands: [{ command: 'bun test', status: 'failed' }],
        nextSteps: ['Repair parse branch'],
      },
      100,
    )

    const merged = mergeWorkingMemory(base, {
      facts: [
        'parser fails on malformed input',
        { text: 'Failure reproduces on Bun test', source: 'test output' },
      ],
      changedFiles: [{ path: 'src/parser.ts', reason: 'test failure' }],
      commands: [
        {
          command: 'bun test',
          status: 'passed',
          exitCode: 0,
          summary: 'all tests passed',
        },
      ],
      nextSteps: ['Repair parse branch', 'Run typecheck'],
      updatedAt: 200,
    })

    expect(merged.facts).toEqual([
      {
        text: 'parser fails on malformed input',
        updatedAt: 200,
      },
      {
        text: 'Failure reproduces on Bun test',
        source: 'test output',
        updatedAt: 200,
      },
    ])
    expect(merged.changedFiles).toEqual([
      {
        path: 'src/parser.ts',
        reason: 'implementation; test failure',
        updatedAt: 200,
      },
    ])
    expect(merged.commands).toEqual([
      {
        command: 'bun test',
        status: 'passed',
        updatedAt: 200,
        exitCode: 0,
        summary: 'all tests passed',
      },
    ])
    expect(merged.nextSteps.map(step => step.text)).toEqual([
      'Repair parse branch',
      'Run typecheck',
    ])
  })

  test('class store returns snapshots and protects internal state', () => {
    const store = new WorkingMemoryStore(undefined, {
      now: () => 100,
    })
    const snapshot = store.update({
      goal: 'Ship feature',
      facts: ['Fact one'],
    })
    snapshot.facts.push({ text: 'Mutated outside' })

    expect(store.getSnapshot().facts).toEqual([
      {
        text: 'Fact one',
        updatedAt: 100,
      },
    ])
  })

  test('serializes a model-readable working memory', () => {
    const memory = createWorkingMemory(
      {
        goal: 'Fix parser',
        verificationStatus: {
          status: 'failed',
          command: 'bun test',
          summary: 'parser test failed',
        },
        nextSteps: ['Patch parser branch'],
        changedFiles: [{ path: 'src/parser.ts', reason: 'implementation' }],
        commands: [
          {
            command: 'bun test',
            status: 'failed',
            exitCode: 1,
            summary: 'parser test failed',
          },
        ],
        facts: [{ text: 'Parser receives token stream', source: 'code' }],
        rejectedHypotheses: ['Lexer output is not empty'],
      },
      100,
    )

    const serialized = serializeWorkingMemory(memory)

    expect(serialized.truncated).toBe(false)
    expect(serialized.text).toContain('## Goal')
    expect(serialized.text).toContain('Fix parser')
    expect(serialized.text).toContain('## Verification Status')
    expect(serialized.text).toContain('failed - command=bun test')
    expect(serialized.text).toContain('## Changed Files')
    expect(serialized.text).toContain('src/parser.ts')
    expect(serialized.text).toContain('## Rejected Hypotheses')
  })

  test('trims by budget while preserving high priority sections', () => {
    const memory = createWorkingMemory(
      {
        goal: 'Fix parser failures',
        verificationStatus: {
          status: 'failed',
          command: 'bun test',
          summary: 'parser failure remains',
        },
        nextSteps: ['Fix parser branch', 'Run focused test'],
        changedFiles: ['src/parser.ts'],
        commands: ['bun test src/parser.test.ts'],
        facts: Array.from({ length: 20 }, (_, index) => ({
          text: `Low priority fact ${index}`,
        })),
        rejectedHypotheses: Array.from({ length: 20 }, (_, index) => ({
          text: `Rejected idea ${index}`,
        })),
      },
      100,
    )

    const serialized = serializeWorkingMemory(memory, { maxChars: 260 })
    const trimmed = trimWorkingMemory(memory, 260)

    expect(serialized.truncated).toBe(true)
    expect(serialized.text).toContain('## Goal')
    expect(serialized.text).toContain('## Verification Status')
    expect(trimmed.goal).toBe('Fix parser failures')
    expect(trimmed.verificationStatus?.status).toBe('failed')
    expect(trimmed.nextSteps.length).toBeGreaterThan(0)
    expect(trimmed.facts.length).toBeLessThan(memory.facts.length)
  })

  test('store applies budget after updates', () => {
    const store = new WorkingMemoryStore(undefined, {
      maxChars: 220,
      now: () => 100,
    })
    store.update({
      goal: 'Fix parser failures',
      verificationStatus: {
        status: 'failed',
        summary: 'must keep this',
      },
      nextSteps: ['Fix parser'],
      facts: Array.from({ length: 30 }, (_, index) => ({
        text: `Fact ${index}`,
      })),
    })

    const serialized = store.serialize()
    expect(serialized.totalChars).toBeLessThanOrEqual(220)
    expect(serialized.text).toContain('Fix parser failures')
    expect(serialized.text).toContain('must keep this')
  })
})
