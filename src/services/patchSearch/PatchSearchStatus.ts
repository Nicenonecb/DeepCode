import type {
  PatchSearchFooterStatus,
  PatchSearchPhase,
  PatchSearchRequest,
  PatchSearchResult,
} from './types.js'

export function createPatchSearchRunningStatus(
  request: Pick<PatchSearchRequest, 'id' | 'maxCandidates'>,
  phase: Extract<PatchSearchPhase, 'running' | 'verifying' | 'selecting'>,
  updatedAt = Date.now(),
): PatchSearchFooterStatus {
  return {
    phase,
    requestId: request.id,
    candidateCount: request.maxCandidates,
    runningCount: phase === 'running' ? request.maxCandidates : 0,
    verifyingCount: phase === 'verifying' ? request.maxCandidates : 0,
    failedCount: 0,
    updatedAt,
  }
}

export function createPatchSearchResultStatus(
  result: PatchSearchResult,
  phase: Extract<
    PatchSearchPhase,
    'applying' | 'completed' | 'failed'
  > = 'completed',
  updatedAt = Date.now(),
): PatchSearchFooterStatus {
  const failedCandidates = result.candidates.filter(
    evaluation =>
      evaluation.candidate.exitStatus === 'failed' ||
      evaluation.candidate.failure !== undefined ||
      evaluation.summary.verificationStatus === 'failed' ||
      evaluation.summary.verificationStatus === 'timed_out',
  )
  const applicationIssue = result.application?.issues[0]
  const candidateFailure = failedCandidates[0]?.candidate.failure
  const failureSummary =
    applicationIssue?.message ??
    candidateFailure?.message ??
    (failedCandidates.length > 0
      ? `${failedCandidates.length} candidate${failedCandidates.length === 1 ? '' : 's'} need attention`
      : undefined)

  return {
    phase,
    requestId: result.requestId,
    candidateCount: result.candidates.length,
    runningCount: 0,
    verifyingCount: 0,
    failedCount: failedCandidates.length,
    ...(result.winner
      ? { selectedCandidateId: result.winner.candidate.id }
      : {}),
    ...(result.winner ? { bestScore: result.winner.score.total } : {}),
    ...(result.application
      ? { applicationStatus: result.application.status }
      : {}),
    ...(failureSummary ? { failureSummary } : {}),
    updatedAt,
  }
}

export function patchSearchStatusLabel(
  status: PatchSearchFooterStatus,
): string {
  if (status.phase === 'running') {
    return `patch running ${status.runningCount}/${status.candidateCount}`
  }
  if (status.phase === 'verifying') {
    return `patch verifying ${status.verifyingCount}/${status.candidateCount}`
  }
  if (status.phase === 'selecting') {
    return `patch selecting ${status.candidateCount}`
  }
  if (status.phase === 'applying') {
    return `patch applying ${status.selectedCandidateId ?? 'winner'}`
  }
  if (status.phase === 'failed') {
    return `patch failed ${status.failedCount}/${status.candidateCount}`
  }

  const score =
    status.bestScore === undefined ? '' : ` score ${status.bestScore}`
  const failures = status.failedCount > 0 ? ` fail ${status.failedCount}` : ''
  return `patch selected ${status.selectedCandidateId ?? 'none'}${score}${failures}`
}
