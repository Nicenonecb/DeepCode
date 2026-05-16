import type { AgenticSandboxTraceBundle } from '../agenticSandbox/index.js'
import type {
  VerificationCommandConfig,
  VerificationSummary,
} from '../verification/index.js'

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

export type BenchmarkContextEvidenceTier = 'hot' | 'warm' | 'cold'

export type BenchmarkContextExpectation = {
  minPromptTokens?: number
  expectedSectionHits?: string[]
  expectedEvidenceTiers?: BenchmarkContextEvidenceTier[]
  maxTruncatedSections?: number
  minPackChars?: number
  agenticSearch?: BenchmarkAgenticSearchMetrics
}

export type BenchmarkAgenticSearchMetrics = {
  mode?: 'rag_baseline' | 'agentic_search'
  searchRounds?: number
  maxFetchConcurrency?: number
  webSearchCount?: number
  webFetchCount?: number
  sourceEvidenceCount?: number
  privateUrlSkippedCount?: number
  evidenceClaimCount?: number
  primaryClaimCount?: number
  independentClaimCount?: number
  conflictCount?: number
  crossCheckCoverage?: number
  citationCount?: number
  citationCompressionRatio?: number
  estimatedInputTokens?: number
  estimatedCostUsd?: number
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
  contextExpectations?: BenchmarkContextExpectation
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

export type BenchmarkHarnessMode = 'dry_run' | 'execute'

export type BenchmarkCandidateKind = 'agent' | 'cli'

export type BenchmarkCandidateCommand = {
  id: string
  label?: string
  kind: BenchmarkCandidateKind
  command?: string
  args?: string[]
  cwd?: string
  prompt?: string
  env?: Record<string, string>
  contextExpectations?: BenchmarkContextExpectation
}

export type BenchmarkTaskExitStatus =
  | 'planned'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export type BenchmarkTranscriptRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'stdout'
  | 'stderr'

export type BenchmarkTranscriptEntry = {
  role: BenchmarkTranscriptRole
  content: string
}

export type BenchmarkExecutionLog = {
  level: 'info' | 'warning' | 'error'
  message: string
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

export type BenchmarkContextMetrics = {
  promptTokens?: number
  packChars?: number
  packBudgetChars?: number
  sectionHits?: string[]
  truncatedSections?: number
  evidenceTiers?: BenchmarkContextEvidenceTier[]
  agenticSearch?: BenchmarkAgenticSearchMetrics
}

export type BenchmarkTaskRun = {
  taskId: string
  candidateId?: string
  cwd?: string
  exitStatus?: BenchmarkTaskExitStatus
  transcript?: BenchmarkTranscriptEntry[]
  logs?: BenchmarkExecutionLog[]
  resolved?: boolean
  verificationSummary?: VerificationSummary
  cost?: Partial<BenchmarkCostMetrics>
  turns?: number
  context?: BenchmarkContextMetrics
  regressions?: BenchmarkRegression[]
  sandbox?: AgenticSandboxTraceBundle
}

export type BenchmarkTaskSummary = BenchmarkTaskRunMetrics & {
  taskId: string
  candidateId?: string
  cwd?: string
  exitStatus?: BenchmarkTaskExitStatus
  score: number
  transcript: BenchmarkTranscriptEntry[]
  logs: BenchmarkExecutionLog[]
  context: BenchmarkContextMetrics
  regressions: BenchmarkRegression[]
  sandbox?: AgenticSandboxTraceBundle
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

export type BenchmarkHarnessRequest = {
  id: string
  dataset: BenchmarkTaskDataset
  candidates: BenchmarkCandidateCommand[]
  mode?: BenchmarkHarnessMode
  maxTasks?: number
  verificationCommands?: VerificationCommandConfig[]
}

export type BenchmarkCandidateSummary = {
  candidateId: string
  label?: string
  taskCount: number
  resolvedRate: number
  verificationPassRate: number
  totalCostUsd: number
  averageTurns: number
  regressionCount: number
  highSeverityRegressionCount: number
}

export type BenchmarkCandidateResult = {
  candidate: BenchmarkCandidateCommand
  tasks: BenchmarkTaskSummary[]
  summary: BenchmarkDatasetSummary
}

export type BenchmarkHarnessSummary = {
  requestId: string
  datasetId: string
  mode: BenchmarkHarnessMode
  candidateCount: number
  taskCount: number
  bestCandidateId?: string
  candidates: BenchmarkCandidateSummary[]
}

export type BenchmarkHarnessResult = {
  requestId: string
  datasetId: string
  mode: BenchmarkHarnessMode
  candidates: BenchmarkCandidateResult[]
  summary: BenchmarkHarnessSummary
}
