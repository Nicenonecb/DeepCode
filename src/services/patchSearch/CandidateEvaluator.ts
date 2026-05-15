import type {
  CandidateScore,
  PatchCandidate,
  PatchCandidateEvaluation,
  PatchCandidateRiskFlag,
  PatchSearchRequest,
  PatchSearchResult,
  PatchSearchSummary,
  SelectionReason,
} from './types.js'

export function evaluatePatchCandidate(
  candidate: PatchCandidate,
  request?: Pick<PatchSearchRequest, 'targetFiles'>,
): PatchCandidateEvaluation {
  const score = scorePatchCandidate(candidate, request)
  const reasons = selectionReasonsFor(candidate, score)

  return {
    candidate,
    score,
    reasons,
    summary: {
      candidateId: candidate.id,
      ...(candidate.label ? { label: candidate.label } : {}),
      ...(candidate.exitStatus ? { exitStatus: candidate.exitStatus } : {}),
      ...(candidate.failure ? { failure: candidate.failure } : {}),
      verificationStatus: score.verificationStatus,
      verificationPassRate: score.verificationPassRate,
      verificationFailureCount: score.verificationFailureCount,
      verificationTimedOutCount: score.verificationTimedOutCount,
      diffSize: score.diffSize,
      filesChanged: score.filesChanged,
      touchedTargetFileCount: score.touchedTargetFileCount,
      targetCoverage: score.targetCoverage,
      riskFlags: riskFlagsFor(candidate, score),
      total: score.total,
      reasons,
    },
  }
}

export function rankPatchCandidates(
  request: Pick<PatchSearchRequest, 'id' | 'targetFiles'>,
  candidates: PatchCandidate[],
): PatchSearchResult {
  const evaluations = candidates
    .map(candidate => evaluatePatchCandidate(candidate, request))
    .sort(compareEvaluations)

  const winner = evaluations[0]

  return {
    requestId: request.id,
    candidates: evaluations,
    winner,
    summary: buildPatchSearchSummary(request.id, evaluations),
  }
}

export function buildPatchSearchSummary(
  requestId: string,
  evaluations: PatchCandidateEvaluation[],
): PatchSearchSummary {
  const winner = evaluations[0]

  return {
    requestId,
    ...(winner ? { winnerCandidateId: winner.candidate.id } : {}),
    selectionReason: winner?.reasons[0] ?? 'no_candidates',
    candidates: evaluations.map(evaluation => evaluation.summary),
  }
}

export function compareEvaluations(
  left: PatchCandidateEvaluation,
  right: PatchCandidateEvaluation,
): number {
  const length = Math.max(left.score.sortKey.length, right.score.sortKey.length)
  for (let index = 0; index < length; index++) {
    const leftValue = left.score.sortKey[index] ?? 0
    const rightValue = right.score.sortKey[index] ?? 0
    if (leftValue !== rightValue) return rightValue - leftValue
  }
  return left.candidate.id.localeCompare(right.candidate.id)
}

function scorePatchCandidate(
  candidate: PatchCandidate,
  request?: Pick<PatchSearchRequest, 'targetFiles'>,
): CandidateScore {
  const verification = verificationMetrics(candidate)
  const diffSize =
    candidate.diffStats.filesChanged +
    candidate.diffStats.insertions +
    candidate.diffStats.deletions
  const targetFiles = request?.targetFiles ?? candidate.targetFiles ?? []
  const targetMatches = touchedTargetFiles(candidate, targetFiles)
  const targetCoverage =
    targetFiles.length > 0 ? targetMatches.size / targetFiles.length : 0
  const riskFlags = riskFlagsFor(candidate, {
    verificationStatus: verification.status,
    diffSize,
    touchedTargetFileCount: targetMatches.size,
    targetFileCount: targetFiles.length,
  })
  const riskFlagCount = riskFlags.filter(
    flag => flag === 'high_risk_file',
  ).length
  const total =
    verification.passRate * 1000 +
    targetCoverage * 200 -
    verification.failureCount * 100 -
    verification.timedOutCount * 100 -
    riskFlagCount * 25 -
    Math.min(diffSize, 1000) / 10

  return {
    candidateId: candidate.id,
    verificationStatus: verification.status,
    verificationPassRate: roundMetric(verification.passRate),
    verificationFailureCount: verification.failureCount,
    verificationTimedOutCount: verification.timedOutCount,
    diffSize,
    filesChanged: candidate.diffStats.filesChanged,
    targetFileCount: targetFiles.length,
    touchedTargetFileCount: targetMatches.size,
    targetCoverage: roundMetric(targetCoverage),
    riskFlagCount,
    total: roundMetric(total),
    sortKey: [
      verificationRank(verification.status),
      -verification.failureCount,
      -verification.timedOutCount,
      -diffSize,
      -riskFlagCount,
      roundMetric(targetCoverage),
    ],
  }
}

function verificationMetrics(candidate: PatchCandidate): {
  status: CandidateScore['verificationStatus']
  passRate: number
  failureCount: number
  timedOutCount: number
} {
  const summary = candidate.verificationSummary
  if (!summary || summary.total === 0) {
    return {
      status: 'not_run',
      passRate: 0,
      failureCount: 0,
      timedOutCount: 0,
    }
  }

  return {
    status: summary.status,
    passRate: summary.passed / summary.total,
    failureCount: summary.failed + summary.timedOut,
    timedOutCount: summary.timedOut,
  }
}

function selectionReasonsFor(
  candidate: PatchCandidate,
  score: CandidateScore,
): SelectionReason[] {
  const reasons: SelectionReason[] = []

  if (score.verificationStatus === 'passed') {
    reasons.push('verification_passed')
  } else if (score.verificationStatus !== 'not_run') {
    reasons.push('verification_better')
  }
  if (score.verificationFailureCount === 0) reasons.push('fewer_failures')
  if (score.touchedTargetFileCount > 0) reasons.push('touches_target_files')
  if (score.riskFlagCount === 0) reasons.push('fewer_risk_flags')
  if (score.diffSize > 0) reasons.push('smaller_diff')

  return reasons.length > 0 ? reasons : ['stable_tiebreak']
}

function riskFlagsFor(
  candidate: PatchCandidate,
  score: Pick<
    CandidateScore,
    | 'verificationStatus'
    | 'diffSize'
    | 'targetFileCount'
    | 'touchedTargetFileCount'
  >,
): PatchCandidateRiskFlag[] {
  const flags = new Set(candidate.riskFlags ?? [])

  if (score.verificationStatus === 'failed') flags.add('verification_failed')
  if (score.verificationStatus === 'timed_out') {
    flags.add('verification_timed_out')
  }
  if (score.diffSize === 0) flags.add('empty_diff')
  if (score.diffSize > 500) flags.add('large_diff')
  if (score.targetFileCount > 0 && score.touchedTargetFileCount === 0) {
    flags.add('missing_target_file')
  }

  return [...flags].sort()
}

function touchedTargetFiles(
  candidate: PatchCandidate,
  targetFiles: { path: string }[],
): Set<string> {
  const touched = new Set(candidate.touchedFiles.map(file => file.path))
  const matches = new Set<string>()

  for (const target of targetFiles) {
    if (touched.has(target.path)) {
      matches.add(target.path)
    }
  }

  return matches
}

function verificationRank(status: CandidateScore['verificationStatus']) {
  switch (status) {
    case 'passed':
      return 2
    case 'failed':
    case 'timed_out':
      return 1
    case 'not_run':
      return 0
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
