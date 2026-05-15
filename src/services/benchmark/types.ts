import type { VerificationSummary } from '../verification/index.js'

export type BenchmarkTaskCategory =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'performance'
  | 'unknown'

export type BenchmarkTaskDifficulty = 'easy' | 'medium' | 'hard'

export type BenchmarkTargetFile = {
  path: string
  required?: boolean
}

export type BenchmarkExpectedOutcome = {
  summary: string
  requiredFiles?: string[]
  forbiddenFiles?: string[]
  assertions?: string[]
  verificationCommands?: string[]
}

export type BenchmarkTaskFixture = {
  id: string
  title: string
  prompt: string
  category?: BenchmarkTaskCategory
  difficulty?: BenchmarkTaskDifficulty
  tags?: string[]
  targetFiles?: BenchmarkTargetFile[]
  setupCommands?: string[]
  verificationCommands?: string[]
  expectedOutcome: BenchmarkExpectedOutcome
  timeoutMs?: number
  metadata?: Record<string, string | number | boolean>
}

export type BenchmarkTaskDataset = {
  id: string
  name: string
  description?: string
  version?: string
  tasks: BenchmarkTaskFixture[]
}

export type BenchmarkRegressionKind =
  | 'verification_regression'
  | 'unexpected_file_change'
  | 'cost_regression'
  | 'turn_regression'
  | 'output_regression'

export type BenchmarkRegression = {
  kind: BenchmarkRegressionKind
  message: string
  severity: 'low' | 'medium' | 'high'
  filePath?: string
}

export type BenchmarkCostMetrics = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  usd: number
}

export type BenchmarkTaskRunMetrics = {
  resolved: boolean
  verificationPassRate: number
  verificationTotal: number
  verificationPassed: number
  verificationFailed: number
  verificationTimedOut: number
  cost: BenchmarkCostMetrics
  turns: number
  regressionCount: number
  highSeverityRegressionCount: number
}

export type BenchmarkTaskRun = {
  taskId: string
  candidateId?: string
  resolved?: boolean
  verificationSummary?: VerificationSummary
  cost?: Partial<BenchmarkCostMetrics>
  turns?: number
  regressions?: BenchmarkRegression[]
}

export type BenchmarkTaskSummary = BenchmarkTaskRunMetrics & {
  taskId: string
  candidateId?: string
  score: number
  regressions: BenchmarkRegression[]
}

export type BenchmarkDatasetSummary = {
  datasetId: string
  taskCount: number
  resolvedCount: number
  resolvedRate: number
  verificationPassRate: number
  totalCostUsd: number
  averageTurns: number
  regressionCount: number
  highSeverityRegressionCount: number
  tasks: BenchmarkTaskSummary[]
}
