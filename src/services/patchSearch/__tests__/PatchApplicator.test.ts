import { describe, expect, test } from 'bun:test'
import { rankPatchCandidates } from '../CandidateEvaluator.js'
import {
  PatchApplicator,
  type PatchApplicationGitRunner,
} from '../PatchApplicator.js'
import type { PatchCandidate, PatchSearchRequest } from '../types.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('PatchApplicator', () => {
  test('defaults to a recommendation with manual apply commands', async () => {
    const git = fakeGit({
      status: '',
      head: 'base-1',
      diff: 'diff --git a/src/query.ts b/src/query.ts\n+fixed\n',
    })
    const applicator = new PatchApplicator({
      git: git.run,
      mainWorktreePath: '/repo',
    })

    const summary = await applicator.applyWinner(
      rankedResult(candidate()),
      request(),
    )

    expect(summary.status).toBe('recommended')
    expect(summary.applied).toBe(false)
    expect(summary.patchSize).toBeGreaterThan(0)
    expect(summary.commands.map(command => command.description)).toEqual([
      'Write the selected candidate diff to a patch file',
      'Check whether the patch applies cleanly',
      'Apply the patch to the main worktree',
    ])
    expect(git.calls.map(call => call.args.join(' '))).not.toContain('apply -')
  })

  test('blocks automatic apply when the main worktree has target conflicts', async () => {
    const git = fakeGit({
      status: ' M src/query.ts\n M README.md\n',
      head: 'base-1',
      diff: 'diff --git a/src/query.ts b/src/query.ts\n+fixed\n',
    })
    const applicator = new PatchApplicator({
      git: git.run,
      mainWorktreePath: '/repo',
    })

    const summary = await applicator.applyWinner(
      rankedResult(candidate()),
      request({ patchApplication: { mode: 'apply' } }),
    )

    expect(summary.status).toBe('blocked')
    expect(summary.applied).toBe(false)
    expect(summary.dirtyFiles).toEqual(['README.md', 'src/query.ts'])
    expect(summary.conflictingFiles).toEqual(['src/query.ts'])
    expect(summary.issues.map(issue => issue.kind)).toContain('dirty_worktree')
    expect(summary.issues.map(issue => issue.kind)).toContain('target_conflict')
    expect(git.calls.map(call => call.args.join(' '))).not.toContain('apply -')
  })

  test('blocks empty candidate diffs before git apply', async () => {
    const git = fakeGit({
      status: '',
      head: 'base-1',
      diff: '',
    })
    const applicator = new PatchApplicator({
      git: git.run,
      mainWorktreePath: '/repo',
    })

    const summary = await applicator.applyWinner(
      rankedResult(candidate()),
      request({ patchApplication: { mode: 'apply' } }),
    )

    expect(summary.status).toBe('blocked')
    expect(summary.issues.map(issue => issue.kind)).toContain('empty_diff')
    expect(git.calls.map(call => call.args.join(' '))).not.toContain('apply -')
  })

  test('blocks automatic apply when the candidate base commit changed', async () => {
    const git = fakeGit({
      status: '',
      head: 'new-main-head',
      diff: 'diff --git a/src/query.ts b/src/query.ts\n+fixed\n',
    })
    const applicator = new PatchApplicator({
      git: git.run,
      mainWorktreePath: '/repo',
    })

    const summary = await applicator.applyWinner(
      rankedResult(candidate()),
      request({ patchApplication: { mode: 'apply' } }),
    )

    expect(summary.status).toBe('blocked')
    expect(summary.issues.map(issue => issue.kind)).toContain('base_mismatch')
    expect(git.calls.map(call => call.args.join(' '))).not.toContain('apply -')
  })

  test('can force-view a failed verification candidate without applying it', async () => {
    const git = fakeGit({
      status: '',
      head: 'base-1',
      diff: 'diff --git a/src/query.ts b/src/query.ts\n+maybe\n',
    })
    const applicator = new PatchApplicator({
      git: git.run,
      mainWorktreePath: '/repo',
    })

    const summary = await applicator.applyWinner(
      rankedResult(
        candidate({
          verificationSummary: verificationSummary({
            status: 'failed',
            total: 2,
            passed: 1,
            failed: 1,
            timedOut: 0,
          }),
        }),
      ),
      request({
        patchApplication: {
          mode: 'recommend',
          allowFailedVerification: true,
        },
      }),
    )

    expect(summary.status).toBe('recommended')
    expect(summary.applied).toBe(false)
    expect(summary.issues.map(issue => issue.kind)).toContain(
      'verification_failed',
    )
    expect(git.calls.map(call => call.args.join(' '))).not.toContain('apply -')
  })

  test('applies a checked patch only when explicitly requested and preflight passes', async () => {
    const git = fakeGit({
      status: '',
      head: 'base-1',
      diff: 'diff --git a/src/query.ts b/src/query.ts\n+fixed\n',
      checkCode: 0,
      applyCode: 0,
    })
    const applicator = new PatchApplicator({
      git: git.run,
      mainWorktreePath: '/repo',
    })

    const summary = await applicator.applyWinner(
      rankedResult(candidate()),
      request({ patchApplication: { mode: 'apply' } }),
    )

    expect(summary.status).toBe('applied')
    expect(summary.applied).toBe(true)
    expect(git.calls.map(call => call.args.join(' '))).toContain(
      'apply --check -',
    )
    expect(git.calls.map(call => call.args.join(' '))).toContain('apply -')
  })
})

function request(
  overrides: Partial<PatchSearchRequest> = {},
): PatchSearchRequest {
  return {
    id: 'patch-search-test',
    prompt: 'fix the bug',
    maxCandidates: 1,
    mode: 'execute',
    targetFiles: [{ path: 'src/query.ts' }],
    ...overrides,
  }
}

function rankedResult(candidate: PatchCandidate) {
  return rankPatchCandidates(request(), [candidate])
}

function candidate(overrides: Partial<PatchCandidate> = {}): PatchCandidate {
  return {
    id: 'candidate-1',
    worktreePath: '/worktree/candidate-1',
    branchName: 'worktree-candidate-1',
    baseCommit: 'base-1',
    exitStatus: 'completed',
    diffStats: { filesChanged: 1, insertions: 2, deletions: 0 },
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

function fakeGit({
  status,
  head,
  diff,
  checkCode = 0,
  applyCode = 0,
}: {
  status: string
  head: string
  diff: string
  checkCode?: number
  applyCode?: number
}): {
  calls: Array<{ cwd: string; args: string[]; input?: string }>
  run: PatchApplicationGitRunner
} {
  const calls: Array<{ cwd: string; args: string[]; input?: string }> = []

  return {
    calls,
    run: async (cwd, args, input) => {
      calls.push({ cwd, args, input })
      const command = args.join(' ')
      if (command === 'status --porcelain') {
        return { code: 0, stdout: status, stderr: '' }
      }
      if (command === 'rev-parse HEAD') {
        return { code: 0, stdout: head, stderr: '' }
      }
      if (command.startsWith('diff ')) {
        return { code: 0, stdout: diff, stderr: '' }
      }
      if (command === 'apply --check -') {
        return {
          code: checkCode,
          stdout: '',
          stderr: checkCode === 0 ? '' : 'patch does not apply',
        }
      }
      if (command === 'apply -') {
        return {
          code: applyCode,
          stdout: '',
          stderr: applyCode === 0 ? '' : 'apply failed',
        }
      }
      return { code: 1, stdout: '', stderr: `unexpected command: ${command}` }
    },
  }
}
