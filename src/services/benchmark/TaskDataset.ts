import type {
  BenchmarkCostMetrics,
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
    regressions,
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
