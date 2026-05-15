import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  BenchmarkHarness,
  buildBenchmarkHarnessSummary,
  createDefaultBenchmarkVerifier,
  dryRunBenchmarkExecutor,
  type BenchmarkTaskExecutor,
} from '../BenchmarkHarness.js'
import type {
  BenchmarkCandidateResult,
  BenchmarkHarnessRequest,
  BenchmarkTaskDataset,
} from '../types.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('BenchmarkHarness', () => {
  test('plans dry-run tasks without invoking a real agent or CLI', async () => {
    const result = await new BenchmarkHarness().run({
      id: 'bench-dry-run',
      dataset: dataset(['task-a', 'task-b']),
      candidates: [{ id: 'cli-a', kind: 'cli', command: 'deepcode' }],
    })

    expect(result.summary).toMatchObject({
      requestId: 'bench-dry-run',
      datasetId: 'dataset',
      mode: 'dry_run',
      candidateCount: 1,
      taskCount: 2,
      bestCandidateId: 'cli-a',
    })
    expect(result.candidates[0]?.tasks.map(task => task.exitStatus)).toEqual([
      'planned',
      'planned',
    ])
    expect(result.candidates[0]?.tasks[0]?.transcript).toEqual([
      { role: 'user', content: 'Prompt for task-a' },
    ])
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  test('runs injected executors in dataset task order for each candidate', async () => {
    const calls: string[] = []
    const executor: BenchmarkTaskExecutor = async input => {
      calls.push(`${input.candidate.id}:${input.task.id}`)
      return {
        exitStatus: 'completed',
        resolved: input.candidate.id === 'agent-good',
        verificationSummary: verificationSummary({
          status: input.candidate.id === 'agent-good' ? 'passed' : 'failed',
          total: 2,
          passed: input.candidate.id === 'agent-good' ? 2 : 1,
          failed: input.candidate.id === 'agent-good' ? 0 : 1,
          timedOut: 0,
        }),
        cost: { inputTokens: 10, outputTokens: 5, usd: 0.01 },
        turns: input.taskIndex + 1,
        transcript: [
          { role: 'user', content: input.task.prompt },
          {
            role: 'assistant',
            content: `${input.candidate.id} completed ${input.task.id}`,
          },
        ],
      }
    }

    const result = await new BenchmarkHarness({ executor }).run({
      id: 'bench-order',
      mode: 'execute',
      dataset: dataset(['task-b', 'task-a']),
      candidates: [
        { id: 'agent-good', kind: 'agent' },
        { id: 'cli-slow', kind: 'cli', command: 'deepcode' },
      ],
    })

    expect(calls).toEqual([
      'agent-good:task-b',
      'agent-good:task-a',
      'cli-slow:task-b',
      'cli-slow:task-a',
    ])
    expect(result.summary.bestCandidateId).toBe('agent-good')
    expect(
      result.summary.candidates.map(candidate => candidate.candidateId),
    ).toEqual(['agent-good', 'cli-slow'])
    expect(result.candidates[0]?.summary.resolvedRate).toBe(1)
    expect(result.candidates[1]?.summary.verificationPassRate).toBe(0.5)
  })

  test('records executor failures as failed task summaries and keeps running later tasks', async () => {
    const executor: BenchmarkTaskExecutor = async input => {
      if (input.task.id === 'task-a') {
        throw new Error('agent crashed')
      }
      return {
        exitStatus: 'completed',
        resolved: true,
        verificationSummary: verificationSummary({
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
          timedOut: 0,
        }),
        turns: 1,
        cost: { usd: 0.01 },
      }
    }

    const result = await new BenchmarkHarness({ executor }).run({
      id: 'bench-failure',
      mode: 'execute',
      dataset: dataset(['task-a', 'task-b']),
      candidates: [{ id: 'agent-a', kind: 'agent' }],
    })

    expect(result.candidates[0]?.tasks.map(task => task.exitStatus)).toEqual([
      'failed',
      'completed',
    ])
    expect(result.candidates[0]?.tasks[0]?.logs).toEqual([
      { level: 'error', message: 'agent crashed' },
    ])
    expect(result.candidates[0]?.summary.regressionCount).toBe(1)
    expect(result.candidates[0]?.summary.resolvedCount).toBe(1)
  })

  test('runs the default VerificationRunner verifier with configured commands', async () => {
    const executor: BenchmarkTaskExecutor = async () => ({
      exitStatus: 'completed',
      turns: 1,
      cost: { usd: 0.01 },
      cwd: process.cwd(),
    })

    const result = await new BenchmarkHarness({
      executor,
      verifier: createDefaultBenchmarkVerifier(),
    }).run({
      id: 'bench-verification',
      mode: 'execute',
      dataset: dataset(['task-a']),
      candidates: [{ id: 'agent-a', kind: 'agent', cwd: process.cwd() }],
      verificationCommands: [
        {
          kind: 'test',
          name: 'Bun version',
          command: 'bun',
          args: ['--version'],
        },
      ],
    })

    const task = result.candidates[0]?.tasks[0]
    expect(task?.verificationPassRate).toBe(1)
    expect(task?.verificationPassed).toBe(1)
    expect(task?.logs).toContainEqual({
      level: 'info',
      message: 'Verification completed for task-a with status passed.',
    })
  })

  test('can use the exported dry-run executor directly for injected tests', async () => {
    const request: BenchmarkHarnessRequest = {
      id: 'direct-dry-run',
      dataset: dataset(['task-a']),
      candidates: [{ id: 'agent-a', kind: 'agent' }],
    }
    const result = await dryRunBenchmarkExecutor({
      request,
      dataset: request.dataset,
      candidate: request.candidates[0]!,
      candidateIndex: 0,
      task: request.dataset.tasks[0]!,
      taskIndex: 0,
      mode: 'dry_run',
    })

    expect(result).toMatchObject({
      exitStatus: 'planned',
      resolved: false,
      turns: 0,
      cost: { usd: 0 },
    })
  })

  test('loads the smoke fixture and produces a low-cost dry-run result', async () => {
    const fixture = JSON.parse(
      await readFile('tests/benchmark/fixtures/smoke.json', 'utf8'),
    ) as {
      id: string
      dataset: BenchmarkTaskDataset
      candidates: BenchmarkHarnessRequest['candidates']
    }

    const result = await new BenchmarkHarness().run({
      id: fixture.id,
      dataset: fixture.dataset,
      candidates: fixture.candidates,
      maxTasks: 2,
    })

    expect(result.summary).toMatchObject({
      requestId: 'benchmark-smoke',
      datasetId: 'deepcode-smoke',
      mode: 'dry_run',
      candidateCount: 2,
      taskCount: 2,
    })
    expect(
      result.candidates.flatMap(candidate => candidate.tasks),
    ).toHaveLength(4)
    expect(
      result.candidates.every(candidate =>
        candidate.tasks.every(task => task.exitStatus === 'planned'),
      ),
    ).toBe(true)
  })
})

describe('buildBenchmarkHarnessSummary', () => {
  test('uses resolved rate, verification, regressions, cost, turns, and id as tie breakers', () => {
    const summary = buildBenchmarkHarnessSummary(
      { id: 'bench-summary', mode: 'execute' },
      'dataset',
      1,
      [
        candidateResult('candidate-b', {
          resolvedRate: 1,
          verificationPassRate: 1,
          totalCostUsd: 0.04,
          averageTurns: 4,
        }),
        candidateResult('candidate-a', {
          resolvedRate: 1,
          verificationPassRate: 1,
          totalCostUsd: 0.01,
          averageTurns: 6,
        }),
      ],
    )

    expect(summary.bestCandidateId).toBe('candidate-a')
    expect(summary.candidates.map(candidate => candidate.candidateId)).toEqual([
      'candidate-a',
      'candidate-b',
    ])
  })
})

function dataset(taskIds: string[]) {
  return {
    id: 'dataset',
    name: 'Dataset',
    tasks: taskIds.map(id => ({
      id,
      title: `Task ${id}`,
      prompt: `Prompt for ${id}`,
      expectedOutcome: { summary: `Expected ${id}` },
    })),
  }
}

function candidateResult(
  candidateId: string,
  overrides: Partial<BenchmarkCandidateResult['summary']>,
): BenchmarkCandidateResult {
  return {
    candidate: { id: candidateId, kind: 'agent' },
    tasks: [],
    summary: {
      datasetId: 'dataset',
      taskCount: 1,
      resolvedCount: 1,
      resolvedRate: 1,
      verificationPassRate: 1,
      totalCostUsd: 0,
      averageTurns: 0,
      regressionCount: 0,
      highSeverityRegressionCount: 0,
      tasks: [],
      ...overrides,
    },
  }
}

function verificationSummary(
  overrides: Pick<
    VerificationSummary,
    'status' | 'total' | 'passed' | 'failed' | 'timedOut'
  >,
): VerificationSummary {
  return {
    durationMs: 100,
    results: [],
    ...overrides,
  }
}
