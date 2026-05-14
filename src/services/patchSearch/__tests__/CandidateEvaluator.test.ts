import { describe, expect, test } from 'bun:test'
import {
  evaluatePatchCandidate,
  rankPatchCandidates,
} from '../CandidateEvaluator.js'
import type { PatchCandidate } from '../types.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('evaluatePatchCandidate', () => {
  test('normalizes verification, diff, target coverage, and risk metrics', () => {
    const evaluation = evaluatePatchCandidate(
      {
        id: 'candidate-a',
        label: 'small focused fix',
        diffStats: { filesChanged: 2, insertions: 12, deletions: 3 },
        touchedFiles: [
          { path: 'src/query.ts', status: 'modified' },
          { path: 'src/query.test.ts', status: 'modified' },
        ],
        verificationSummary: verificationSummary({
          status: 'passed',
          total: 4,
          passed: 4,
          failed: 0,
          timedOut: 0,
        }),
      },
      {
        targetFiles: [
          { path: 'src/query.ts', required: true },
          { path: 'src/services/patchSearch/PatchSearchRunner.ts' },
        ],
      },
    )

    expect(evaluation.summary).toEqual({
      candidateId: 'candidate-a',
      label: 'small focused fix',
      verificationStatus: 'passed',
      verificationPassRate: 1,
      verificationFailureCount: 0,
      verificationTimedOutCount: 0,
      diffSize: 17,
      filesChanged: 2,
      touchedTargetFileCount: 1,
      targetCoverage: 0.5,
      riskFlags: [],
      total: 1098.3,
      reasons: [
        'verification_passed',
        'fewer_failures',
        'touches_target_files',
        'fewer_risk_flags',
        'smaller_diff',
      ],
    })
    expect(JSON.parse(JSON.stringify(evaluation.summary))).toEqual(
      evaluation.summary,
    )
  })

  test('adds derived risk flags for failed verification and missing targets', () => {
    const evaluation = evaluatePatchCandidate(
      {
        id: 'candidate-risk',
        diffStats: { filesChanged: 1, insertions: 0, deletions: 0 },
        touchedFiles: [{ path: 'README.md', status: 'modified' }],
        riskFlags: ['high_risk_file'],
        verificationSummary: verificationSummary({
          status: 'failed',
          total: 3,
          passed: 1,
          failed: 2,
          timedOut: 0,
        }),
      },
      {
        targetFiles: [{ path: 'src/query.ts', required: true }],
      },
    )

    expect(evaluation.summary.verificationPassRate).toBe(0.333)
    expect(evaluation.summary.verificationFailureCount).toBe(2)
    expect(evaluation.summary.riskFlags).toEqual([
      'high_risk_file',
      'missing_target_file',
      'verification_failed',
    ])
  })
})

describe('rankPatchCandidates', () => {
  test('prefers verification success before smaller failed diffs', () => {
    const failedSmall = candidate({
      id: 'failed-small',
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
      verificationSummary: verificationSummary({
        status: 'failed',
        total: 2,
        passed: 1,
        failed: 1,
        timedOut: 0,
      }),
    })
    const passedLarger = candidate({
      id: 'passed-larger',
      diffStats: { filesChanged: 5, insertions: 80, deletions: 20 },
      verificationSummary: verificationSummary({
        status: 'passed',
        total: 2,
        passed: 2,
        failed: 0,
        timedOut: 0,
      }),
    })

    const result = rankPatchCandidates(
      {
        id: 'patch-search-1',
        targetFiles: [{ path: 'src/query.ts' }],
      },
      [failedSmall, passedLarger],
    )

    expect(result.winner?.candidate.id).toBe('passed-larger')
    expect(result.summary).toEqual({
      requestId: 'patch-search-1',
      winnerCandidateId: 'passed-larger',
      selectionReason: 'verification_passed',
      candidates: result.candidates.map(evaluation => evaluation.summary),
    })
  })

  test('uses target coverage, risk flags, diff size, and id as deterministic tie breakers', () => {
    const risky = candidate({
      id: 'candidate-b',
      touchedFiles: [{ path: 'src/other.ts' }],
      riskFlags: ['high_risk_file'],
    })
    const focused = candidate({
      id: 'candidate-a',
      touchedFiles: [{ path: 'src/query.ts' }],
      riskFlags: [],
    })

    const result = rankPatchCandidates(
      {
        id: 'patch-search-2',
        targetFiles: [{ path: 'src/query.ts' }],
      },
      [risky, focused],
    )

    expect(
      result.candidates.map(evaluation => evaluation.candidate.id),
    ).toEqual(['candidate-a', 'candidate-b'])
    expect(result.candidates[0]?.summary.reasons).toContain(
      'touches_target_files',
    )
  })

  test('returns a stable empty summary when there are no candidates', () => {
    const result = rankPatchCandidates({ id: 'empty' }, [])

    expect(result.winner).toBeUndefined()
    expect(result.summary).toEqual({
      requestId: 'empty',
      selectionReason: 'no_candidates',
      candidates: [],
    })
  })
})

function candidate(overrides: Partial<PatchCandidate>): PatchCandidate {
  return {
    id: 'candidate',
    diffStats: { filesChanged: 2, insertions: 10, deletions: 5 },
    touchedFiles: [{ path: 'src/query.ts', status: 'modified' }],
    verificationSummary: verificationSummary({
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
      timedOut: 0,
    }),
    ...overrides,
  }
}

function verificationSummary(
  overrides: Pick<
    VerificationSummary,
    'status' | 'total' | 'passed' | 'failed' | 'timedOut'
  >,
): VerificationSummary {
  return {
    durationMs: 100,
    results: [],
    ...overrides,
  }
}
