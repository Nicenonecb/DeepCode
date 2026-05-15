import type {
  BenchmarkCandidateResult,
  BenchmarkHarnessResult,
  BenchmarkTaskSummary,
} from './types.js'

export type BenchmarkReportTask = {
  taskId: string
  resolved: boolean
  exitStatus?: string
  verificationPassRate: number
  costUsd: number
  turns: number
  regressionCount: number
  score: number
}

export type BenchmarkReportCandidate = {
  candidateId: string
  label?: string
  resolvedRate: number
  verificationPassRate: number
  totalCostUsd: number
  averageTurns: number
  regressionCount: number
  highSeverityRegressionCount: number
  tasks: BenchmarkReportTask[]
}

export type BenchmarkJsonReport = {
  requestId: string
  datasetId: string
  mode: string
  bestCandidateId?: string
  candidates: BenchmarkReportCandidate[]
}

export function createBenchmarkJsonReport(
  result: BenchmarkHarnessResult,
): BenchmarkJsonReport {
  return {
    requestId: result.requestId,
    datasetId: result.datasetId,
    mode: result.mode,
    ...(result.summary.bestCandidateId
      ? { bestCandidateId: result.summary.bestCandidateId }
      : {}),
    candidates: sortedCandidateResults(result).map(candidateResult => ({
      candidateId: candidateResult.candidate.id,
      ...(candidateResult.candidate.label
        ? { label: candidateResult.candidate.label }
        : {}),
      resolvedRate: candidateResult.summary.resolvedRate,
      verificationPassRate: candidateResult.summary.verificationPassRate,
      totalCostUsd: candidateResult.summary.totalCostUsd,
      averageTurns: candidateResult.summary.averageTurns,
      regressionCount: candidateResult.summary.regressionCount,
      highSeverityRegressionCount:
        candidateResult.summary.highSeverityRegressionCount,
      tasks: candidateResult.tasks.map(taskReport),
    })),
  }
}

export function formatBenchmarkJsonReport(
  result: BenchmarkHarnessResult,
): string {
  return `${JSON.stringify(createBenchmarkJsonReport(result), null, 2)}\n`
}

export function formatBenchmarkMarkdownReport(
  result: BenchmarkHarnessResult,
): string {
  const report = createBenchmarkJsonReport(result)
  const lines = [
    `# Benchmark ${report.requestId}`,
    '',
    `Dataset: ${report.datasetId}`,
    `Mode: ${report.mode}`,
    `Best candidate: ${report.bestCandidateId ?? 'none'}`,
    '',
    '| Candidate | Resolved | Verification | Cost | Turns | Regressions |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]

  for (const candidate of report.candidates) {
    lines.push(
      [
        `| ${candidate.candidateId}`,
        percent(candidate.resolvedRate),
        percent(candidate.verificationPassRate),
        currency(candidate.totalCostUsd),
        String(candidate.averageTurns),
        `${candidate.regressionCount} (${candidate.highSeverityRegressionCount} high) |`,
      ].join(' | '),
    )
  }

  for (const candidate of report.candidates) {
    lines.push('', `## ${candidate.candidateId}`, '')
    lines.push(
      '| Task | Status | Resolved | Verification | Cost | Turns | Regressions | Score |',
    )
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const task of candidate.tasks) {
      lines.push(
        [
          `| ${task.taskId}`,
          task.exitStatus ?? 'unknown',
          task.resolved ? 'yes' : 'no',
          percent(task.verificationPassRate),
          currency(task.costUsd),
          String(task.turns),
          String(task.regressionCount),
          `${task.score} |`,
        ].join(' | '),
      )
    }
  }

  return `${lines.join('\n')}\n`
}

function sortedCandidateResults(
  result: BenchmarkHarnessResult,
): BenchmarkCandidateResult[] {
  const byId = new Map(
    result.candidates.map(candidate => [candidate.candidate.id, candidate]),
  )
  return result.summary.candidates
    .map(candidate => byId.get(candidate.candidateId))
    .filter(
      (candidate): candidate is BenchmarkCandidateResult =>
        candidate !== undefined,
    )
}

function taskReport(task: BenchmarkTaskSummary): BenchmarkReportTask {
  return {
    taskId: task.taskId,
    resolved: task.resolved,
    ...(task.exitStatus ? { exitStatus: task.exitStatus } : {}),
    verificationPassRate: task.verificationPassRate,
    costUsd: task.cost.usd,
    turns: task.turns,
    regressionCount: task.regressionCount,
    score: task.score,
  }
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

function currency(value: number): string {
  return `$${value.toFixed(6)}`
}
