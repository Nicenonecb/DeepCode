import { join } from 'node:path'
import {
  createAgenticSandboxVerificationExecutor,
  type AgenticSandboxTraceBundle,
  type AgenticSandboxTraceRef,
} from '../agenticSandbox/index.js'
import {
  VerificationRunner,
  type VerificationRunnerSettings,
  type VerificationSummary,
  type VerificationCommandConfig,
} from '../verification/index.js'
import {
  createSandboxTraceBundle,
  createBenchmarkTaskDataset,
  summarizeBenchmarkDataset,
  summarizeBenchmarkTaskRun,
} from './TaskDataset.js'
import type {
  BenchmarkCandidateCommand,
  BenchmarkCandidateResult,
  BenchmarkCandidateSummary,
  BenchmarkContextMetrics,
  BenchmarkDatasetSummary,
  BenchmarkExecutionLog,
  BenchmarkHarnessMode,
  BenchmarkHarnessRequest,
  BenchmarkHarnessResult,
  BenchmarkHarnessSummary,
  BenchmarkRegression,
  BenchmarkTaskDataset,
  BenchmarkTaskFixture,
  BenchmarkTaskRun,
  BenchmarkTaskSummary,
  BenchmarkTranscriptEntry,
} from './types.js'

const DEFAULT_MAX_TASKS = 50

export type BenchmarkHarnessOptions = {
  executor?: BenchmarkTaskExecutor
  verifier?: BenchmarkTaskVerifier
  maxTasks?: number
}

export type BenchmarkTaskExecutor = (
  input: BenchmarkTaskExecutorInput,
) => Promise<BenchmarkTaskExecutorResult>

export type BenchmarkTaskExecutorInput = {
  request: BenchmarkHarnessRequest
  dataset: BenchmarkTaskDataset
  candidate: BenchmarkCandidateCommand
  candidateIndex: number
  task: BenchmarkTaskFixture
  taskIndex: number
  mode: BenchmarkHarnessMode
}

export type BenchmarkTaskExecutorResult = Omit<
  BenchmarkTaskRun,
  'taskId' | 'candidateId'
>

export type BenchmarkTaskVerifier = (
  input: BenchmarkTaskVerifierInput,
) => Promise<BenchmarkTaskVerifierResult>

export type BenchmarkTaskVerifierInput = BenchmarkTaskExecutorInput & {
  run: BenchmarkTaskRun
}

export type BenchmarkTaskVerifierResult = {
  verificationSummary?: VerificationSummary
  logs?: BenchmarkExecutionLog[]
  regressions?: BenchmarkRegression[]
  sandbox?: AgenticSandboxTraceBundle
}

export class BenchmarkHarness {
  private readonly executor: BenchmarkTaskExecutor
  private readonly verifier: BenchmarkTaskVerifier
  private readonly maxTasks: number

  constructor(options: BenchmarkHarnessOptions = {}) {
    this.executor = options.executor ?? dryRunBenchmarkExecutor
    this.verifier = options.verifier ?? createDefaultBenchmarkVerifier()
    this.maxTasks = normalizeMaxTasks(options.maxTasks)
  }

  async run(request: BenchmarkHarnessRequest): Promise<BenchmarkHarnessResult> {
    const normalizedRequest = normalizeHarnessRequest(request, this.maxTasks)
    const dataset = createBenchmarkTaskDataset(normalizedRequest.dataset)
    const tasks = dataset.tasks.slice(0, normalizedRequest.maxTasks)
    const candidates = normalizedRequest.candidates.map(normalizeCandidate)
    const candidateResults: BenchmarkCandidateResult[] = []

    for (
      let candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex++
    ) {
      const candidate = candidates[candidateIndex]
      const runs: BenchmarkTaskRun[] = []

      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex]
        runs.push(
          await this.runTask(
            normalizedRequest,
            dataset,
            candidate,
            candidateIndex,
            task,
            taskIndex,
          ),
        )
      }

      const summary = summarizeBenchmarkDataset({ id: dataset.id, tasks }, runs)
      candidateResults.push({
        candidate,
        tasks: runs.map(summarizeBenchmarkTaskRun),
        summary,
      })
    }

    return {
      requestId: normalizedRequest.id,
      datasetId: dataset.id,
      mode: normalizedRequest.mode ?? 'dry_run',
      candidates: candidateResults,
      summary: buildBenchmarkHarnessSummary(
        normalizedRequest,
        dataset.id,
        tasks.length,
        candidateResults,
      ),
    }
  }

  private async runTask(
    request: BenchmarkHarnessRequest,
    dataset: BenchmarkTaskDataset,
    candidate: BenchmarkCandidateCommand,
    candidateIndex: number,
    task: BenchmarkTaskFixture,
    taskIndex: number,
  ): Promise<BenchmarkTaskRun> {
    try {
      const result = await this.executor({
        request,
        dataset,
        candidate,
        candidateIndex,
        task,
        taskIndex,
        mode: request.mode ?? 'dry_run',
      })

      return await this.verifyTask(
        request,
        dataset,
        candidate,
        candidateIndex,
        task,
        taskIndex,
        normalizeTaskRun(task, candidate, result),
      )
    } catch (error) {
      return failedTaskRun(task, candidate, error)
    }
  }

  private async verifyTask(
    request: BenchmarkHarnessRequest,
    dataset: BenchmarkTaskDataset,
    candidate: BenchmarkCandidateCommand,
    candidateIndex: number,
    task: BenchmarkTaskFixture,
    taskIndex: number,
    run: BenchmarkTaskRun,
  ): Promise<BenchmarkTaskRun> {
    if (run.exitStatus === 'failed' || run.exitStatus === 'cancelled') {
      return run
    }

    try {
      const verification = await this.verifier({
        request,
        dataset,
        candidate,
        candidateIndex,
        task,
        taskIndex,
        mode: request.mode ?? 'dry_run',
        run,
      })
      return mergeVerificationResult(run, verification)
    } catch (error) {
      return mergeVerificationResult(run, {
        logs: [{ level: 'error', message: errorMessage(error) }],
        regressions: [
          {
            kind: 'verification_regression',
            message: `Verification failed: ${errorMessage(error)}`,
            severity: 'high',
          },
        ],
      })
    }
  }
}

export function buildBenchmarkHarnessSummary(
  request: Pick<BenchmarkHarnessRequest, 'id' | 'mode'>,
  datasetId: string,
  taskCount: number,
  results: BenchmarkCandidateResult[],
): BenchmarkHarnessSummary {
  const candidates = results
    .map(result => candidateSummary(result.candidate, result.summary))
    .sort(compareCandidateSummaries)
  const bestCandidateId = candidates[0]?.candidateId

  return {
    requestId: request.id,
    datasetId,
    mode: request.mode ?? 'dry_run',
    candidateCount: candidates.length,
    taskCount,
    ...(bestCandidateId ? { bestCandidateId } : {}),
    candidates,
  }
}

export async function dryRunBenchmarkExecutor(
  input: BenchmarkTaskExecutorInput,
): Promise<BenchmarkTaskExecutorResult> {
  const context = plannedContextMetricsFor(input.task, input.candidate)
  return {
    exitStatus: 'planned',
    resolved: false,
    turns: 0,
    cost: { usd: 0 },
    transcript: [
      {
        role: 'user',
        content: input.task.prompt,
      },
    ],
    logs: [
      {
        level: 'info',
        message: `Planned ${input.candidate.kind} candidate ${input.candidate.id} for task ${input.task.id}.`,
      },
      ...(context
        ? [
            {
              level: 'info' as const,
              message: `Planned context expectations for ${input.task.id}: ${contextSummary(context)}.`,
            },
          ]
        : []),
    ],
    ...(context ? { context } : {}),
  }
}

export function createDefaultBenchmarkVerifier(): BenchmarkTaskVerifier {
  return async input => {
    if (input.mode !== 'execute') {
      return {
        logs: [
          {
            level: 'info',
            message: `Skipped verification for ${input.task.id} in ${input.mode} mode.`,
          },
        ],
      }
    }

    const cwd = input.run.cwd ?? input.candidate.cwd
    if (!cwd) {
      return {
        logs: [
          {
            level: 'warning',
            message: `Skipped verification for ${input.task.id} because no cwd was provided.`,
          },
        ],
      }
    }

    const settings = verificationSettingsFor(input.request, input.task)
    const sandboxSessionId = sandboxSessionIdFor(input)
    const sandboxTraces: AgenticSandboxTraceRef[] = []
    const summary = await new VerificationRunner({
      cwd,
      settings,
      executor: createAgenticSandboxVerificationExecutor({
        sessionId: sandboxSessionId,
        purpose: 'benchmark-verification',
        traceDir: join(cwd, '.deepcode', 'sandbox-traces', 'benchmark'),
        metadata: {
          benchmarkRequestId: input.request.id,
          benchmarkDatasetId: input.dataset.id,
          benchmarkTaskId: input.task.id,
          benchmarkCandidateId: input.candidate.id,
          benchmarkMode: input.mode,
        },
        onTrace: trace => sandboxTraces.push(trace),
      }),
    }).run()
    const sandbox = createSandboxTraceBundle(sandboxSessionId, sandboxTraces)

    return {
      verificationSummary: summary,
      sandbox,
      logs: [
        {
          level: 'info',
          message: `Verification completed for ${input.task.id} with status ${summary.status}.`,
        },
        {
          level: 'info',
          message: `Sandbox trace recorded ${sandbox.manifestPaths.length} manifest(s) for ${input.task.id}.`,
        },
      ],
      regressions:
        summary.status === 'passed'
          ? []
          : [
              {
                kind: 'verification_regression',
                message: `Verification ${summary.status}: ${summary.passed}/${summary.total} commands passed.`,
                severity: 'high',
              },
            ],
    }
  }
}

function normalizeHarnessRequest(
  request: BenchmarkHarnessRequest,
  runnerMaxTasks: number,
): BenchmarkHarnessRequest {
  const maxTasks = Math.min(normalizeMaxTasks(request.maxTasks), runnerMaxTasks)

  return {
    ...request,
    mode: request.mode ?? 'dry_run',
    maxTasks,
    candidates: request.candidates.map(normalizeCandidate),
  }
}

function normalizeCandidate(
  candidate: BenchmarkCandidateCommand,
): BenchmarkCandidateCommand {
  return {
    id: candidate.id,
    ...(candidate.label ? { label: candidate.label } : {}),
    kind: candidate.kind,
    ...(candidate.command ? { command: candidate.command } : {}),
    ...(candidate.args ? { args: [...candidate.args] } : {}),
    ...(candidate.cwd ? { cwd: candidate.cwd } : {}),
    ...(candidate.prompt ? { prompt: candidate.prompt } : {}),
    ...(candidate.env ? { env: sortStringRecord(candidate.env) } : {}),
    ...(candidate.contextExpectations
      ? { contextExpectations: candidate.contextExpectations }
      : {}),
  }
}

function normalizeTaskRun(
  task: BenchmarkTaskFixture,
  candidate: BenchmarkCandidateCommand,
  result: BenchmarkTaskExecutorResult,
): BenchmarkTaskRun {
  return {
    taskId: task.id,
    candidateId: candidate.id,
    ...((result.cwd ?? candidate.cwd)
      ? { cwd: result.cwd ?? candidate.cwd }
      : {}),
    ...(result.exitStatus ? { exitStatus: result.exitStatus } : {}),
    ...(result.transcript
      ? { transcript: normalizeTranscript(result.transcript) }
      : {}),
    ...(result.logs ? { logs: normalizeLogs(result.logs) } : {}),
    ...(result.resolved === undefined ? {} : { resolved: result.resolved }),
    ...(result.verificationSummary
      ? { verificationSummary: result.verificationSummary }
      : {}),
    ...(result.cost ? { cost: result.cost } : {}),
    ...(result.turns === undefined ? {} : { turns: result.turns }),
    ...(result.context ? { context: result.context } : {}),
    ...(result.regressions
      ? { regressions: normalizeRegressions(result.regressions) }
      : {}),
    ...(result.sandbox ? { sandbox: result.sandbox } : {}),
  }
}

function mergeVerificationResult(
  run: BenchmarkTaskRun,
  verification: BenchmarkTaskVerifierResult,
): BenchmarkTaskRun {
  return {
    ...run,
    ...(verification.verificationSummary
      ? { verificationSummary: verification.verificationSummary }
      : {}),
    logs: [...(run.logs ?? []), ...(verification.logs ?? [])],
    regressions: [
      ...(run.regressions ?? []),
      ...(verification.regressions ?? []),
    ],
    ...(verification.sandbox ? { sandbox: verification.sandbox } : {}),
  }
}

function failedTaskRun(
  task: BenchmarkTaskFixture,
  candidate: BenchmarkCandidateCommand,
  error: unknown,
): BenchmarkTaskRun {
  return {
    taskId: task.id,
    candidateId: candidate.id,
    exitStatus: 'failed',
    resolved: false,
    turns: 0,
    cost: { usd: 0 },
    logs: [
      {
        level: 'error',
        message: errorMessage(error),
      },
    ],
    regressions: [
      {
        kind: 'output_regression',
        message: `Executor failed: ${errorMessage(error)}`,
        severity: 'high',
      },
    ],
  }
}

function candidateSummary(
  candidate: BenchmarkCandidateCommand,
  summary: BenchmarkDatasetSummary,
): BenchmarkCandidateSummary {
  return {
    candidateId: candidate.id,
    ...(candidate.label ? { label: candidate.label } : {}),
    taskCount: summary.taskCount,
    resolvedRate: summary.resolvedRate,
    verificationPassRate: summary.verificationPassRate,
    totalCostUsd: summary.totalCostUsd,
    averageTurns: summary.averageTurns,
    regressionCount: summary.regressionCount,
    highSeverityRegressionCount: summary.highSeverityRegressionCount,
  }
}

function compareCandidateSummaries(
  left: BenchmarkCandidateSummary,
  right: BenchmarkCandidateSummary,
): number {
  if (left.resolvedRate !== right.resolvedRate) {
    return right.resolvedRate - left.resolvedRate
  }
  if (left.verificationPassRate !== right.verificationPassRate) {
    return right.verificationPassRate - left.verificationPassRate
  }
  if (left.highSeverityRegressionCount !== right.highSeverityRegressionCount) {
    return left.highSeverityRegressionCount - right.highSeverityRegressionCount
  }
  if (left.regressionCount !== right.regressionCount) {
    return left.regressionCount - right.regressionCount
  }
  if (left.totalCostUsd !== right.totalCostUsd) {
    return left.totalCostUsd - right.totalCostUsd
  }
  if (left.averageTurns !== right.averageTurns) {
    return left.averageTurns - right.averageTurns
  }
  return left.candidateId.localeCompare(right.candidateId)
}

function verificationSettingsFor(
  request: BenchmarkHarnessRequest,
  task: BenchmarkTaskFixture,
): VerificationRunnerSettings {
  return {
    enabled: true,
    commands: verificationCommandsFor(request, task),
  }
}

function verificationCommandsFor(
  request: BenchmarkHarnessRequest,
  task: BenchmarkTaskFixture,
): VerificationCommandConfig[] | undefined {
  return (
    request.verificationCommands ??
    task.verificationCommands ??
    task.expectedOutcome.verificationCommands
  )
}

function sandboxSessionIdFor(input: BenchmarkTaskVerifierInput): string {
  return sanitizeSessionId(
    `benchmark-${input.request.id}-${input.dataset.id}-${input.candidate.id}-${input.task.id}`,
  )
}

function normalizeMaxTasks(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_MAX_TASKS
  return Math.max(1, Math.floor(value))
}

function sanitizeSessionId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 96) || 'benchmark'
  )
}

function normalizeTranscript(
  transcript: BenchmarkTranscriptEntry[],
): BenchmarkTranscriptEntry[] {
  return transcript.map(entry => ({
    role: entry.role,
    content: entry.content,
  }))
}

function normalizeLogs(logs: BenchmarkExecutionLog[]): BenchmarkExecutionLog[] {
  return logs.map(log => ({
    level: log.level,
    message: log.message,
  }))
}

function normalizeRegressions(
  regressions: BenchmarkRegression[],
): BenchmarkRegression[] {
  return regressions.map(regression => ({
    kind: regression.kind,
    message: regression.message,
    severity: regression.severity,
    ...(regression.filePath ? { filePath: regression.filePath } : {}),
  }))
}

function sortStringRecord(
  record: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function plannedContextMetricsFor(
  task: BenchmarkTaskFixture,
  candidate?: BenchmarkCandidateCommand,
): BenchmarkContextMetrics | undefined {
  const expectations =
    candidate?.contextExpectations ?? task.contextExpectations
  if (!expectations) return undefined

  return {
    ...(expectations.minPromptTokens === undefined
      ? {}
      : { promptTokens: expectations.minPromptTokens }),
    ...(expectations.minPackChars === undefined
      ? {}
      : { packChars: expectations.minPackChars }),
    ...(expectations.expectedSectionHits
      ? { sectionHits: expectations.expectedSectionHits }
      : {}),
    ...(expectations.maxTruncatedSections === undefined
      ? {}
      : { truncatedSections: expectations.maxTruncatedSections }),
    ...(expectations.expectedEvidenceTiers
      ? { evidenceTiers: expectations.expectedEvidenceTiers }
      : {}),
    ...(expectations.agenticSearch
      ? { agenticSearch: expectations.agenticSearch }
      : {}),
  }
}

function contextSummary(context: BenchmarkContextMetrics): string {
  const parts: string[] = []
  if (context.promptTokens !== undefined) {
    parts.push(`${Math.trunc(context.promptTokens)} prompt tokens`)
  }
  if (context.packChars !== undefined) {
    parts.push(`${Math.trunc(context.packChars)} pack chars`)
  }
  if (context.sectionHits?.length) {
    parts.push(`${context.sectionHits.length} section hits`)
  }
  if (context.truncatedSections !== undefined) {
    parts.push(`${Math.trunc(context.truncatedSections)} truncated sections`)
  }
  if (context.agenticSearch?.mode) {
    parts.push(`${context.agenticSearch.mode} search`)
  }
  return parts.length > 0 ? parts.join(', ') : 'no context metrics'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
