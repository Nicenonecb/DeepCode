import { describe, expect, test } from 'bun:test'
import {
  BenchmarkHarness,
  type BenchmarkTaskExecutor,
} from '../BenchmarkHarness.js'
import {
  createBenchmarkJsonReport,
  formatBenchmarkJsonReport,
  formatBenchmarkMarkdownReport,
} from '../Reporter.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('Benchmark Reporter', () => {
  test('outputs sorted stable JSON summary', async () => {
    const result = await benchmarkResult()
    const report = createBenchmarkJsonReport(result)

    expect(report).toEqual({
      requestId: 'bench-report',
      datasetId: 'dataset',
      mode: 'execute',
      bestCandidateId: 'agent-good',
      candidates: [
        {
          candidateId: 'agent-good',
          resolvedRate: 1,
          verificationPassRate: 1,
          totalCostUsd: 0.01,
          averageTurns: 2,
          regressionCount: 0,
          highSeverityRegressionCount: 0,
          tasks: [
            {
              taskId: 'task-a',
              resolved: true,
              exitStatus: 'completed',
              verificationPassRate: 1,
              costUsd: 0.01,
              turns: 2,
              regressionCount: 0,
              score: 1497.95,
            },
          ],
        },
        {
          candidateId: 'cli-slow',
          resolvedRate: 0,
          verificationPassRate: 0.5,
          totalCostUsd: 0.02,
          averageTurns: 4,
          regressionCount: 1,
          highSeverityRegressionCount: 1,
          tasks: [
            {
              taskId: 'task-a',
              resolved: false,
              exitStatus: 'completed',
              verificationPassRate: 0.5,
              costUsd: 0.02,
              turns: 4,
              regressionCount: 1,
              score: -4.1,
            },
          ],
        },
      ],
    })
    expect(JSON.parse(formatBenchmarkJsonReport(result))).toEqual(report)
  })

  test('outputs Markdown summary in ranking order', async () => {
    const markdown = formatBenchmarkMarkdownReport(await benchmarkResult())

    expect(markdown).toContain('# Benchmark bench-report')
    expect(markdown).toContain('Best candidate: agent-good')
    expect(markdown.indexOf('| agent-good |')).toBeLessThan(
      markdown.indexOf('| cli-slow |'),
    )
    expect(markdown).toContain(
      '| task-a | completed | yes | 100% | $0.010000 | 2 | 0 | 1497.95 |',
    )
  })
})

async function benchmarkResult() {
  const executor: BenchmarkTaskExecutor = async input => ({
    exitStatus: 'completed',
    resolved: input.candidate.id === 'agent-good',
    verificationSummary:
      input.candidate.id === 'agent-good'
        ? verificationSummary({
            status: 'passed',
            total: 2,
            passed: 2,
            failed: 0,
            timedOut: 0,
          })
        : verificationSummary({
            status: 'failed',
            total: 2,
            passed: 1,
            failed: 1,
            timedOut: 0,
          }),
    cost: { usd: input.candidate.id === 'agent-good' ? 0.01 : 0.02 },
    turns: input.candidate.id === 'agent-good' ? 2 : 4,
    regressions:
      input.candidate.id === 'agent-good'
        ? []
        : [
            {
              kind: 'verification_regression',
              message: 'test failed',
              severity: 'high',
            },
          ],
  })

  return new BenchmarkHarness({
    executor,
    verifier: async () => ({}),
  }).run({
    id: 'bench-report',
    mode: 'execute',
    dataset: {
      id: 'dataset',
      name: 'Dataset',
      tasks: [
        {
          id: 'task-a',
          title: 'Task A',
          prompt: 'Prompt A',
          expectedOutcome: { summary: 'Expected A' },
        },
      ],
    },
    candidates: [
      { id: 'cli-slow', kind: 'cli' },
      { id: 'agent-good', kind: 'agent' },
    ],
  })
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
