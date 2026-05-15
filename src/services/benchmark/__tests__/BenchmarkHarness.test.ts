import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

  test('runs the default verifier with configured commands and sandbox trace manifests', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'benchmark-sandbox-'))
    const executor: BenchmarkTaskExecutor = async () => ({
      exitStatus: 'completed',
      turns: 1,
      cost: { usd: 0.01 },
      cwd,
    })

    const result = await new BenchmarkHarness({
      executor,
      verifier: createDefaultBenchmarkVerifier(),
    }).run({
      id: 'bench-verification',
      mode: 'execute',
      dataset: dataset(['task-a']),
      candidates: [{ id: 'agent-a', kind: 'agent', cwd }],
      verificationCommands: [
        {
          kind: 'test',
          name: 'Sandbox Echo',
          command: 'bun',
          args: ['--eval', 'console.log("sandbox benchmark")'],
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
    expect(task?.sandbox).toMatchObject({
      sessionId: 'benchmark-bench-verification-dataset-agent-a-task-a',
      commandCount: 1,
      policyViolationCount: 0,
    })
    expect(task?.sandbox?.manifestPaths).toHaveLength(1)
    const manifest = JSON.parse(
      await readFile(task?.sandbox?.manifestPaths[0] ?? '', 'utf8'),
    ) as {
      sessionId: string
      purpose: string
      metadata: Record<string, string>
      summary: { commandCount: number }
    }
    expect(manifest).toMatchObject({
      sessionId:
        'benchmark-bench-verification-dataset-agent-a-task-a-sandbox-echo',
      purpose: 'benchmark-verification',
      metadata: {
        benchmarkRequestId: 'bench-verification',
        benchmarkDatasetId: 'dataset',
        benchmarkTaskId: 'task-a',
        benchmarkCandidateId: 'agent-a',
      },
      summary: { commandCount: 1 },
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

  test('projects long-context expectations into dry-run context evidence', async () => {
    const result = await dryRunBenchmarkExecutor({
      request: {
        id: 'direct-long-context-dry-run',
        dataset: dataset(['task-a']),
        candidates: [{ id: 'agent-a', kind: 'agent' }],
      },
      dataset: dataset(['task-a']),
      candidate: { id: 'agent-a', kind: 'agent' },
      candidateIndex: 0,
      task: {
        id: 'task-a',
        title: 'Task A',
        prompt: 'Prompt A',
        expectedOutcome: { summary: 'Expected A' },
        contextExpectations: {
          minPromptTokens: 300000,
          minPackChars: 900000,
          expectedSectionHits: ['hot:task', 'warm:related_files'],
          expectedEvidenceTiers: ['hot', 'warm', 'cold'],
          maxTruncatedSections: 2,
        },
      },
      taskIndex: 0,
      mode: 'dry_run',
    })

    expect(result.context).toEqual({
      promptTokens: 300000,
      packChars: 900000,
      sectionHits: ['hot:task', 'warm:related_files'],
      truncatedSections: 2,
      evidenceTiers: ['hot', 'warm', 'cold'],
    })
    expect(result.logs).toContainEqual({
      level: 'info',
      message:
        'Planned context expectations for task-a: 300000 prompt tokens, 900000 pack chars, 2 section hits, 2 truncated sections.',
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

  test('loads the long-context fixture with context expectations', async () => {
    const fixture = JSON.parse(
      await readFile(
        'tests/benchmark/fixtures/deepseek-long-context.json',
        'utf8',
      ),
    ) as {
      id: string
      dataset: BenchmarkTaskDataset
      candidates: BenchmarkHarnessRequest['candidates']
    }

    const result = await new BenchmarkHarness().run({
      id: fixture.id,
      dataset: fixture.dataset,
      candidates: fixture.candidates,
      maxTasks: 4,
    })

    expect(result.summary).toMatchObject({
      requestId: 'deepseek-long-context',
      datasetId: 'deepseek-v4-pro-long-context',
      mode: 'dry_run',
      candidateCount: 2,
      taskCount: 4,
    })
    expect(result.candidates[0]?.tasks[0]?.context).toMatchObject({
      promptTokens: 300000,
      packChars: 900000,
      sectionHits: [
        'cold:repo_map',
        'hot:lsp',
        'hot:task',
        'warm:related_files',
      ],
      truncatedSections: 2,
      evidenceTiers: ['hot', 'warm', 'cold'],
    })
    expect(fixture.dataset.tasks.map(task => task.contextExpectations)).toEqual(
      [
        expect.objectContaining({
          minPromptTokens: 300000,
          expectedSectionHits: [
            'cold:repo_map',
            'hot:lsp',
            'hot:task',
            'warm:related_files',
          ],
        }),
        expect.objectContaining({
          minPromptTokens: 220000,
          expectedEvidenceTiers: ['hot', 'warm', 'cold'],
        }),
        expect.objectContaining({
          minPromptTokens: 360000,
          expectedSectionHits: [
            'cold:repo_map',
            'hot:diff',
            'hot:task',
            'hot:verification',
            'warm:test_hints',
          ],
        }),
        expect.objectContaining({
          minPromptTokens: 420000,
          maxTruncatedSections: 3,
        }),
      ],
    )
  })

  test('loads the agentic sandbox stability fixture', async () => {
    const fixture = JSON.parse(
      await readFile(
        'tests/benchmark/fixtures/agentic-sandbox-stability.json',
        'utf8',
      ),
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
      requestId: 'agentic-sandbox-stability',
      datasetId: 'terminal-swe-pro-stability',
      mode: 'dry_run',
      candidateCount: 2,
      taskCount: 2,
    })
    expect(fixture.dataset.tasks.map(task => task.tags)).toEqual([
      ['agentic-sandbox', 'terminal-bench', 'trace-manifest'],
      ['agentic-sandbox', 'cost', 'regression', 'swe-pro'],
    ])
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
