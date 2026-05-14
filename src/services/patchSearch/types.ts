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

export type PatchCandidate = {
  id: string
  label?: string
  worktreePath?: string
  branchName?: string
  baseCommit?: string
  diffStats: PatchCandidateDiffStats
  touchedFiles: PatchCandidateFile[]
  targetFiles?: PatchSearchTargetFile[]
  riskFlags?: PatchCandidateRiskFlag[]
  verificationSummary?: VerificationSummary
}

export type PatchSearchRequest = {
  id: string
  prompt: string
  maxCandidates: number
  targetFiles?: PatchSearchTargetFile[]
  verificationCommands?: string[]
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
  verificationStatus: CandidateScore['verificationStatus']
  verificationPassRate: number
  verificationFailureCount: number
  verificationTimedOutCount: number
  diffSize: number
  filesChanged: number
  touchedTargetFileCount: number
  targetCoverage: number
  riskFlags: PatchCandidateRiskFlag[]
  total: number
  reasons: SelectionReason[]
}

export type PatchSearchResult = {
  requestId: string
  candidates: PatchCandidateEvaluation[]
  winner?: PatchCandidateEvaluation
  summary: PatchSearchSummary
}

export type PatchSearchSummary = {
  requestId: string
  winnerCandidateId?: string
  selectionReason: SelectionReason
  candidates: PatchCandidateScoreSummary[]
}
