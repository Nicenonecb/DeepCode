import type {
  AgenticSandboxTraceBundle,
  AgenticSandboxTraceRef,
} from '../agenticSandbox/index.js'
import type {
  BenchmarkCostMetrics,
  BenchmarkContextEvidenceTier,
  BenchmarkContextMetrics,
  BenchmarkDatasetSummary,
  BenchmarkRegression,
  BenchmarkTaskDataset,
  BenchmarkTaskFixture,
  BenchmarkTaskRun,
  BenchmarkTaskRunMetrics,
  BenchmarkTaskSummary,
} from './types.js'

export function createBenchmarkTaskDataset(
  dataset: BenchmarkTaskDataset,
): BenchmarkTaskDataset {
  assertUniqueTaskIds(dataset.tasks)

  return {
    id: dataset.id,
    name: dataset.name,
    ...(dataset.description ? { description: dataset.description } : {}),
    ...(dataset.version ? { version: dataset.version } : {}),
    tasks: dataset.tasks.map(normalizeBenchmarkTaskFixture),
  }
}

export function normalizeBenchmarkTaskFixture(
  fixture: BenchmarkTaskFixture,
): BenchmarkTaskFixture {
  return {
    id: fixture.id,
    title: fixture.title,
    prompt: fixture.prompt,
    category: fixture.category ?? 'unknown',
    ...(fixture.difficulty ? { difficulty: fixture.difficulty } : {}),
    ...(fixture.tags ? { tags: [...fixture.tags].sort() } : {}),
    ...(fixture.targetFiles
      ? {
          targetFiles: [...fixture.targetFiles]
            .map(file => ({
              path: file.path,
              ...(file.required === undefined
                ? {}
                : { required: file.required }),
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
        }
      : {}),
    ...(fixture.setupCommands
      ? { setupCommands: [...fixture.setupCommands] }
      : {}),
    ...(fixture.verificationCommands
      ? { verificationCommands: [...fixture.verificationCommands] }
      : {}),
    expectedOutcome: {
      summary: fixture.expectedOutcome.summary,
      ...(fixture.expectedOutcome.requiredFiles
        ? {
            requiredFiles: [...fixture.expectedOutcome.requiredFiles].sort(),
          }
        : {}),
      ...(fixture.expectedOutcome.forbiddenFiles
        ? {
            forbiddenFiles: [...fixture.expectedOutcome.forbiddenFiles].sort(),
          }
        : {}),
      ...(fixture.expectedOutcome.assertions
        ? { assertions: [...fixture.expectedOutcome.assertions] }
        : {}),
      ...(fixture.expectedOutcome.verificationCommands
        ? {
            verificationCommands: [
              ...fixture.expectedOutcome.verificationCommands,
            ],
          }
        : {}),
    },
    ...(fixture.contextExpectations
      ? {
          contextExpectations: {
            ...(fixture.contextExpectations.minPromptTokens === undefined
              ? {}
              : {
                  minPromptTokens: Math.max(
                    0,
                    Math.trunc(fixture.contextExpectations.minPromptTokens),
                  ),
                }),
            ...(fixture.contextExpectations.expectedSectionHits
              ? {
                  expectedSectionHits: [
                    ...fixture.contextExpectations.expectedSectionHits,
                  ].sort(),
                }
              : {}),
            ...(fixture.contextExpectations.expectedEvidenceTiers
              ? {
                  expectedEvidenceTiers: normalizeEvidenceTiers(
                    fixture.contextExpectations.expectedEvidenceTiers,
                  ),
                }
              : {}),
            ...(fixture.contextExpectations.maxTruncatedSections === undefined
              ? {}
              : {
                  maxTruncatedSections: Math.max(
                    0,
                    Math.trunc(
                      fixture.contextExpectations.maxTruncatedSections,
                    ),
                  ),
                }),
            ...(fixture.contextExpectations.minPackChars === undefined
              ? {}
              : {
                  minPackChars: Math.max(
                    0,
                    Math.trunc(fixture.contextExpectations.minPackChars),
                  ),
                }),
          },
        }
      : {}),
    ...(fixture.timeoutMs ? { timeoutMs: fixture.timeoutMs } : {}),
    ...(fixture.metadata
      ? { metadata: sortRecordByKey(fixture.metadata) }
      : {}),
  }
}

export function summarizeBenchmarkTaskRun(
  run: BenchmarkTaskRun,
): BenchmarkTaskSummary {
  const metrics = normalizeBenchmarkTaskRunMetrics(run)
  const regressions = normalizeRegressions(run.regressions ?? [])

  return {
    taskId: run.taskId,
    ...(run.candidateId ? { candidateId: run.candidateId } : {}),
    ...(run.cwd ? { cwd: run.cwd } : {}),
    ...(run.exitStatus ? { exitStatus: run.exitStatus } : {}),
    ...metrics,
    score: scoreBenchmarkTask(metrics),
    transcript: normalizeTranscript(run.transcript ?? []),
    logs: normalizeLogs(run.logs ?? []),
    context: normalizeContextMetrics(run.context ?? {}),
    regressions,
    ...(run.sandbox
      ? { sandbox: normalizeSandboxTraceBundle(run.sandbox) }
      : {}),
  }
}

export function summarizeBenchmarkDataset(
  dataset: Pick<BenchmarkTaskDataset, 'id' | 'tasks'>,
  runs: BenchmarkTaskRun[],
): BenchmarkDatasetSummary {
  const taskIds = new Set(dataset.tasks.map(task => task.id))
  const tasks = runs
    .filter(run => taskIds.has(run.taskId))
    .map(summarizeBenchmarkTaskRun)
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
  const taskCount = tasks.length
  const resolvedCount = tasks.filter(task => task.resolved).length
  const totalCostUsd = roundMetric(
    tasks.reduce((total, task) => total + task.cost.usd, 0),
  )
  const totalTurns = tasks.reduce((total, task) => total + task.turns, 0)
  const regressionCount = tasks.reduce(
    (total, task) => total + task.regressionCount,
    0,
  )
  const highSeverityRegressionCount = tasks.reduce(
    (total, task) => total + task.highSeverityRegressionCount,
    0,
  )

  return {
    datasetId: dataset.id,
    taskCount,
    resolvedCount,
    resolvedRate: taskCount > 0 ? roundMetric(resolvedCount / taskCount) : 0,
    verificationPassRate:
      taskCount > 0
        ? roundMetric(
            tasks.reduce(
              (total, task) => total + task.verificationPassRate,
              0,
            ) / taskCount,
          )
        : 0,
    totalCostUsd,
    averageTurns: taskCount > 0 ? roundMetric(totalTurns / taskCount) : 0,
    regressionCount,
    highSeverityRegressionCount,
    tasks,
  }
}

export function normalizeBenchmarkTaskRunMetrics(
  run: BenchmarkTaskRun,
): BenchmarkTaskRunMetrics {
  const summary = run.verificationSummary
  const verificationTotal = summary?.total ?? 0
  const verificationPassed = summary?.passed ?? 0
  const verificationFailed = summary?.failed ?? 0
  const verificationTimedOut = summary?.timedOut ?? 0
  const verificationPassRate =
    verificationTotal > 0 ? verificationPassed / verificationTotal : 0
  const regressions = run.regressions ?? []
  const regressionCount = regressions.length
  const highSeverityRegressionCount = regressions.filter(
    regression => regression.severity === 'high',
  ).length
  const resolved =
    run.resolved ??
    (summary?.status === 'passed' && regressionCount === 0) ??
    false

  return {
    resolved,
    verificationPassRate: roundMetric(verificationPassRate),
    verificationTotal,
    verificationPassed,
    verificationFailed,
    verificationTimedOut,
    cost: normalizeCostMetrics(run.cost ?? {}),
    turns: Math.max(0, Math.trunc(run.turns ?? 0)),
    regressionCount,
    highSeverityRegressionCount,
  }
}

export function normalizeCostMetrics(
  cost: Partial<BenchmarkCostMetrics>,
): BenchmarkCostMetrics {
  const totalTokens =
    cost.totalTokens ??
    (cost.inputTokens ?? 0) +
      (cost.outputTokens ?? 0) +
      (cost.cacheReadTokens ?? 0) +
      (cost.cacheWriteTokens ?? 0)

  return {
    ...(cost.inputTokens === undefined
      ? {}
      : { inputTokens: Math.max(0, Math.trunc(cost.inputTokens)) }),
    ...(cost.outputTokens === undefined
      ? {}
      : { outputTokens: Math.max(0, Math.trunc(cost.outputTokens)) }),
    ...(cost.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: Math.max(0, Math.trunc(cost.cacheReadTokens)) }),
    ...(cost.cacheWriteTokens === undefined
      ? {}
      : {
          cacheWriteTokens: Math.max(0, Math.trunc(cost.cacheWriteTokens)),
        }),
    totalTokens: Math.max(0, Math.trunc(totalTokens)),
    usd: roundCurrency(Math.max(0, cost.usd ?? 0)),
  }
}

export function normalizeContextMetrics(
  context: BenchmarkContextMetrics,
): BenchmarkContextMetrics {
  return {
    ...(context.promptTokens === undefined
      ? {}
      : { promptTokens: Math.max(0, Math.trunc(context.promptTokens)) }),
    ...(context.packChars === undefined
      ? {}
      : { packChars: Math.max(0, Math.trunc(context.packChars)) }),
    ...(context.packBudgetChars === undefined
      ? {}
      : {
          packBudgetChars: Math.max(0, Math.trunc(context.packBudgetChars)),
        }),
    ...(context.sectionHits
      ? { sectionHits: [...new Set(context.sectionHits)].sort() }
      : {}),
    ...(context.truncatedSections === undefined
      ? {}
      : {
          truncatedSections: Math.max(0, Math.trunc(context.truncatedSections)),
        }),
    ...(context.evidenceTiers
      ? { evidenceTiers: normalizeEvidenceTiers(context.evidenceTiers) }
      : {}),
  }
}

function scoreBenchmarkTask(metrics: BenchmarkTaskRunMetrics): number {
  const resolvedBonus = metrics.resolved ? 1000 : 0
  const verificationScore = metrics.verificationPassRate * 500
  const regressionPenalty =
    metrics.regressionCount * 100 + metrics.highSeverityRegressionCount * 150
  const costPenalty = Math.min(metrics.cost.usd, 100) * 5
  const turnPenalty = Math.min(metrics.turns, 100)

  return roundMetric(
    resolvedBonus +
      verificationScore -
      regressionPenalty -
      costPenalty -
      turnPenalty,
  )
}

function normalizeRegressions(
  regressions: BenchmarkRegression[],
): BenchmarkRegression[] {
  return regressions
    .map(regression => ({
      kind: regression.kind,
      message: regression.message,
      severity: regression.severity,
      ...(regression.filePath ? { filePath: regression.filePath } : {}),
    }))
    .sort((left, right) => {
      const severity =
        severityRank(right.severity) - severityRank(left.severity)
      if (severity !== 0) return severity
      const kind = left.kind.localeCompare(right.kind)
      if (kind !== 0) return kind
      return left.message.localeCompare(right.message)
    })
}

function normalizeTranscript(
  transcript: BenchmarkTaskSummary['transcript'],
): BenchmarkTaskSummary['transcript'] {
  return transcript.map(entry => ({
    role: entry.role,
    content: entry.content,
  }))
}

function normalizeLogs(
  logs: BenchmarkTaskSummary['logs'],
): BenchmarkTaskSummary['logs'] {
  return logs.map(log => ({
    level: log.level,
    message: log.message,
  }))
}

export function createSandboxTraceBundle(
  sessionId: string,
  traces: AgenticSandboxTraceRef[],
): AgenticSandboxTraceBundle {
  const normalizedTraces = normalizeSandboxTraceRefs(traces)
  return {
    sessionId,
    ...(normalizedTraces[0]?.traceDir
      ? { traceDir: normalizedTraces[0].traceDir }
      : {}),
    traces: normalizedTraces,
    manifestPaths: uniqueSorted(
      normalizedTraces.map(trace => trace.manifestPath),
    ),
    replayScriptPaths: uniqueSorted(
      normalizedTraces.flatMap(trace =>
        trace.replayScriptPath ? [trace.replayScriptPath] : [],
      ),
    ),
    snapshotPaths: uniqueSorted(
      normalizedTraces.flatMap(trace =>
        trace.snapshotPath ? [trace.snapshotPath] : [],
      ),
    ),
    commandCount: normalizedTraces.reduce(
      (total, trace) => total + trace.commandCount,
      0,
    ),
    policyViolationCount: normalizedTraces.reduce(
      (total, trace) => total + trace.policyViolationCount,
      0,
    ),
    fallbackReasons: uniqueSorted(
      normalizedTraces.flatMap(trace =>
        trace.fallbackReason ? [trace.fallbackReason] : [],
      ),
    ),
  }
}

export function normalizeSandboxTraceBundle(
  bundle: AgenticSandboxTraceBundle,
): AgenticSandboxTraceBundle {
  const traces = normalizeSandboxTraceRefs(bundle.traces)
  return {
    sessionId: bundle.sessionId,
    ...(bundle.traceDir ? { traceDir: bundle.traceDir } : {}),
    traces,
    manifestPaths: uniqueSorted([
      ...bundle.manifestPaths,
      ...traces.map(trace => trace.manifestPath),
    ]),
    replayScriptPaths: uniqueSorted([
      ...bundle.replayScriptPaths,
      ...traces.flatMap(trace =>
        trace.replayScriptPath ? [trace.replayScriptPath] : [],
      ),
    ]),
    snapshotPaths: uniqueSorted([
      ...bundle.snapshotPaths,
      ...traces.flatMap(trace =>
        trace.snapshotPath ? [trace.snapshotPath] : [],
      ),
    ]),
    commandCount: Math.max(0, Math.trunc(bundle.commandCount)),
    policyViolationCount: Math.max(0, Math.trunc(bundle.policyViolationCount)),
    fallbackReasons: uniqueSorted(bundle.fallbackReasons),
  }
}

function normalizeSandboxTraceRefs(
  traces: AgenticSandboxTraceRef[],
): AgenticSandboxTraceRef[] {
  return traces
    .map(trace => ({
      sessionId: trace.sessionId,
      purpose: trace.purpose,
      status: trace.status,
      substrate: trace.substrate,
      ...(trace.requestedSubstrate
        ? { requestedSubstrate: trace.requestedSubstrate }
        : {}),
      ...(trace.fallbackReason ? { fallbackReason: trace.fallbackReason } : {}),
      traceDir: trace.traceDir,
      manifestPath: trace.manifestPath,
      ...(trace.replayScriptPath
        ? { replayScriptPath: trace.replayScriptPath }
        : {}),
      ...(trace.snapshotPath ? { snapshotPath: trace.snapshotPath } : {}),
      commandCount: Math.max(0, Math.trunc(trace.commandCount)),
      policyViolationCount: Math.max(0, Math.trunc(trace.policyViolationCount)),
    }))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function assertUniqueTaskIds(tasks: BenchmarkTaskFixture[]): void {
  const seen = new Set<string>()

  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate benchmark task id: ${task.id}`)
    }
    seen.add(task.id)
  }
}

function sortRecordByKey(
  record: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function normalizeEvidenceTiers(
  tiers: BenchmarkContextEvidenceTier[],
): BenchmarkContextEvidenceTier[] {
  const rank: Record<BenchmarkContextEvidenceTier, number> = {
    hot: 0,
    warm: 1,
    cold: 2,
  }
  return [...new Set(tiers)].sort((left, right) => rank[left] - rank[right])
}

function severityRank(severity: BenchmarkRegression['severity']): number {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
