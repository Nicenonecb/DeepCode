import { describe, expect, test } from 'bun:test'
import {
  createBenchmarkTaskDataset,
  normalizeBenchmarkTaskRunMetrics,
  summarizeBenchmarkDataset,
  summarizeBenchmarkTaskRun,
} from '../TaskDataset.js'
import type { BenchmarkTaskDataset, BenchmarkTaskRun } from '../types.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('createBenchmarkTaskDataset', () => {
  test('normalizes task fixtures into stable serializable order', () => {
    const dataset = createBenchmarkTaskDataset({
      id: 'core',
      name: 'Core tasks',
      tasks: [
        {
          id: 'repair-query',
          title: 'Repair query loop',
          prompt: 'Fix the retry loop',
          tags: ['repair', 'query'],
          targetFiles: [
            { path: 'src/query.ts', required: true },
            { path: 'src/services/tools/toolExecution.ts' },
          ],
          metadata: { priority: 1, owner: 'runtime', stable: true },
          expectedOutcome: {
            summary: 'Retryable tool failures are repaired locally.',
            requiredFiles: ['src/query.ts', 'src/services/toolRepair/types.ts'],
            forbiddenFiles: ['dist/cli.js'],
            assertions: ['successful tools are not rerun'],
          },
        },
      ],
    })

    expect(dataset.tasks[0]).toEqual({
      id: 'repair-query',
      title: 'Repair query loop',
      prompt: 'Fix the retry loop',
      category: 'unknown',
      tags: ['query', 'repair'],
      targetFiles: [
        { path: 'src/query.ts', required: true },
        { path: 'src/services/tools/toolExecution.ts' },
      ],
      expectedOutcome: {
        summary: 'Retryable tool failures are repaired locally.',
        requiredFiles: ['src/query.ts', 'src/services/toolRepair/types.ts'],
        forbiddenFiles: ['dist/cli.js'],
        assertions: ['successful tools are not rerun'],
      },
      metadata: { owner: 'runtime', priority: 1, stable: true },
    })
    expect(JSON.parse(JSON.stringify(dataset))).toEqual(dataset)
  })

  test('rejects duplicate task ids', () => {
    expect(() =>
      createBenchmarkTaskDataset({
        id: 'duplicates',
        name: 'Duplicates',
        tasks: [fixture('same'), fixture('same')],
      }),
    ).toThrow('Duplicate benchmark task id: same')
  })
})

describe('normalizeBenchmarkTaskRunMetrics', () => {
  test('derives resolved, verification pass rate, cost, turns, and regression counts', () => {
    const metrics = normalizeBenchmarkTaskRunMetrics({
      taskId: 'repair-query',
      verificationSummary: verificationSummary({
        status: 'failed',
        total: 4,
        passed: 3,
        failed: 1,
        timedOut: 0,
      }),
      cost: {
        inputTokens: 1200.8,
        outputTokens: 300.2,
        usd: 0.01234567,
      },
      turns: 5.9,
      regressions: [
        {
          kind: 'verification_regression',
          message: 'typecheck failed',
          severity: 'high',
        },
      ],
    })

    expect(metrics).toEqual({
      resolved: false,
      verificationPassRate: 0.75,
      verificationTotal: 4,
      verificationPassed: 3,
      verificationFailed: 1,
      verificationTimedOut: 0,
      cost: {
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1501,
        usd: 0.012346,
      },
      turns: 5,
      regressionCount: 1,
      highSeverityRegressionCount: 1,
    })
  })
})

describe('summarizeBenchmarkTaskRun', () => {
  test('builds a stable task summary with sorted regressions and score', () => {
    const summary = summarizeBenchmarkTaskRun({
      taskId: 'task-a',
      candidateId: 'candidate-a',
      resolved: true,
      verificationSummary: verificationSummary({
        status: 'passed',
        total: 2,
        passed: 2,
        failed: 0,
        timedOut: 0,
      }),
      cost: { usd: 0.02 },
      turns: 3,
      regressions: [
        {
          kind: 'output_regression',
          message: 'minor copy drift',
          severity: 'low',
        },
        {
          kind: 'unexpected_file_change',
          message: 'touched generated output',
          severity: 'medium',
          filePath: 'dist/cli.js',
        },
      ],
    })

    expect(summary).toEqual({
      taskId: 'task-a',
      candidateId: 'candidate-a',
      resolved: true,
      verificationPassRate: 1,
      verificationTotal: 2,
      verificationPassed: 2,
      verificationFailed: 0,
      verificationTimedOut: 0,
      cost: { totalTokens: 0, usd: 0.02 },
      turns: 3,
      regressionCount: 2,
      highSeverityRegressionCount: 0,
      score: 1296.9,
      transcript: [],
      logs: [],
      regressions: [
        {
          kind: 'unexpected_file_change',
          message: 'touched generated output',
          severity: 'medium',
          filePath: 'dist/cli.js',
        },
        {
          kind: 'output_regression',
          message: 'minor copy drift',
          severity: 'low',
        },
      ],
    })
  })
})

describe('summarizeBenchmarkDataset', () => {
  test('aggregates resolved rate, verification pass rate, cost, turns, and regressions', () => {
    const dataset: BenchmarkTaskDataset = {
      id: 'core',
      name: 'Core tasks',
      tasks: [fixture('task-b'), fixture('task-a')],
    }
    const runs: BenchmarkTaskRun[] = [
      {
        taskId: 'task-b',
        resolved: false,
        verificationSummary: verificationSummary({
          status: 'failed',
          total: 2,
          passed: 1,
          failed: 1,
          timedOut: 0,
        }),
        cost: { usd: 0.02 },
        turns: 4,
      },
      {
        taskId: 'task-a',
        resolved: true,
        verificationSummary: verificationSummary({
          status: 'passed',
          total: 2,
          passed: 2,
          failed: 0,
          timedOut: 0,
        }),
        cost: { usd: 0.01 },
        turns: 2,
      },
      {
        taskId: 'outside-dataset',
        resolved: true,
        cost: { usd: 100 },
        turns: 20,
      },
    ]

    expect(summarizeBenchmarkDataset(dataset, runs)).toMatchObject({
      datasetId: 'core',
      taskCount: 2,
      resolvedCount: 1,
      resolvedRate: 0.5,
      verificationPassRate: 0.75,
      totalCostUsd: 0.03,
      averageTurns: 3,
      regressionCount: 0,
      highSeverityRegressionCount: 0,
      tasks: [{ taskId: 'task-a' }, { taskId: 'task-b' }],
    })
  })
})

function fixture(id: string) {
  return {
    id,
    title: `Task ${id}`,
    prompt: 'Do the task',
    expectedOutcome: {
      summary: 'The task is done.',
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
