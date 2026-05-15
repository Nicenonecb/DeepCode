import type { AgenticSandboxTraceBundle } from '../agenticSandbox/index.js'
import type { VerificationSummary } from '../verification/index.js'

export type PatchSearchTargetFile = {
  path: string
  required?: boolean
}

export type PatchCandidateFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'unknown'

export type PatchCandidateFile = {
  path: string
  status?: PatchCandidateFileStatus
}

export type PatchCandidateDiffStats = {
  filesChanged: number
  insertions: number
  deletions: number
}

export type PatchCandidateRiskFlag =
  | 'high_risk_file'
  | 'large_diff'
  | 'verification_failed'
  | 'verification_timed_out'
  | 'missing_target_file'
  | 'empty_diff'

export type PatchSearchMode = 'dry_run' | 'execute'

export type PatchSearchPhase =
  | 'idle'
  | 'running'
  | 'verifying'
  | 'selecting'
  | 'applying'
  | 'completed'
  | 'failed'

export type PatchCandidateExitStatus =
  | 'planned'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PatchCandidateFailureKind =
  | 'candidate_limit_exceeded'
  | 'worktree_create_failed'
  | 'agent_spawn_failed'
  | 'diff_collection_failed'
  | 'executor_failed'
  | 'verification_failed'
  | 'cleanup_failed'

export type PatchCandidateFailure = {
  kind: PatchCandidateFailureKind
  message: string
  retryable: boolean
  details?: Record<string, string | number | boolean>
}

export type PatchCandidateExecutionLog = {
  level: 'info' | 'warning' | 'error'
  message: string
}

export type PatchCandidateWorktree = {
  slug: string
  path?: string
  branchName?: string
  baseCommit?: string
  gitRoot?: string
  hookBased?: boolean
}

export type PatchCandidateTrajectory = {
  id: string
  index: number
  prompt: string
  worktree: PatchCandidateWorktree
}

export type PatchCandidate = {
  id: string
  label?: string
  worktreePath?: string
  branchName?: string
  baseCommit?: string
  exitStatus?: PatchCandidateExitStatus
  executionLogs?: PatchCandidateExecutionLog[]
  failure?: PatchCandidateFailure
  diffStats: PatchCandidateDiffStats
  touchedFiles: PatchCandidateFile[]
  targetFiles?: PatchSearchTargetFile[]
  riskFlags?: PatchCandidateRiskFlag[]
  verificationSummary?: VerificationSummary
  sandbox?: AgenticSandboxTraceBundle
}

export type PatchSearchRequest = {
  id: string
  prompt: string
  maxCandidates: number
  mode?: PatchSearchMode
  cleanupWorktrees?: boolean
  patchApplication?: PatchApplicationRequest
  targetFiles?: PatchSearchTargetFile[]
  verificationCommands?: string[]
}

export type PatchApplicationMode = 'recommend' | 'apply'

export type PatchApplicationRequest = {
  mode?: PatchApplicationMode
  mainWorktreePath?: string
  allowDirtyWorkingTree?: boolean
  allowBaseMismatch?: boolean
  allowTargetConflicts?: boolean
  allowFailedVerification?: boolean
  patchFilePath?: string
}

export type PatchApplicationStatus = 'recommended' | 'applied' | 'blocked'

export type PatchApplicationIssueKind =
  | 'no_winner'
  | 'missing_worktree'
  | 'empty_diff'
  | 'dirty_worktree'
  | 'target_conflict'
  | 'base_mismatch'
  | 'verification_failed'
  | 'git_status_failed'
  | 'head_read_failed'
  | 'diff_collection_failed'
  | 'patch_check_failed'
  | 'apply_failed'

export type PatchApplicationIssue = {
  kind: PatchApplicationIssueKind
  message: string
  retryable: boolean
  details?: Record<string, string | number | boolean>
}

export type PatchApplicationCommand = {
  description: string
  command: string
}

export type PatchApplicationSummary = {
  status: PatchApplicationStatus
  mode: PatchApplicationMode
  candidateId?: string
  mainWorktreePath?: string
  candidateWorktreePath?: string
  patchFilePath?: string
  patchSize: number
  applied: boolean
  message: string
  commands: PatchApplicationCommand[]
  issues: PatchApplicationIssue[]
  dirtyFiles: string[]
  conflictingFiles: string[]
}

export type PatchSearchFooterStatus = {
  phase: PatchSearchPhase
  requestId: string
  candidateCount: number
  runningCount: number
  verifyingCount: number
  failedCount: number
  selectedCandidateId?: string
  bestScore?: number
  applicationStatus?: PatchApplicationStatus
  failureSummary?: string
  updatedAt: number
}

export type SelectionReason =
  | 'verification_passed'
  | 'verification_better'
  | 'fewer_failures'
  | 'smaller_diff'
  | 'touches_target_files'
  | 'fewer_risk_flags'
  | 'stable_tiebreak'
  | 'no_candidates'

export type CandidateScore = {
  candidateId: string
  verificationStatus: 'passed' | 'failed' | 'timed_out' | 'not_run'
  verificationPassRate: number
  verificationFailureCount: number
  verificationTimedOutCount: number
  diffSize: number
  filesChanged: number
  targetFileCount: number
  touchedTargetFileCount: number
  targetCoverage: number
  riskFlagCount: number
  total: number
  sortKey: number[]
}

export type PatchCandidateEvaluation = {
  candidate: PatchCandidate
  score: CandidateScore
  reasons: SelectionReason[]
  summary: PatchCandidateScoreSummary
}

export type PatchCandidateScoreSummary = {
  candidateId: string
  label?: string
  exitStatus?: PatchCandidateExitStatus
  failure?: PatchCandidateFailure
  verificationStatus: CandidateScore['verificationStatus']
  verificationPassRate: number
  verificationFailureCount: number
  verificationTimedOutCount: number
  diffSize: number
  filesChanged: number
  touchedTargetFileCount: number
  targetCoverage: number
  riskFlags: PatchCandidateRiskFlag[]
  sandbox?: AgenticSandboxTraceBundle
  total: number
  reasons: SelectionReason[]
}

export type PatchSearchResult = {
  requestId: string
  candidates: PatchCandidateEvaluation[]
  winner?: PatchCandidateEvaluation
  application?: PatchApplicationSummary
  summary: PatchSearchSummary
}

export type PatchSearchSummary = {
  requestId: string
  winnerCandidateId?: string
  selectionReason: SelectionReason
  application?: PatchApplicationSummary
  candidates: PatchCandidateScoreSummary[]
}
