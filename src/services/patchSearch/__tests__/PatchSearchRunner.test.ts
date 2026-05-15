import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createDefaultCandidateVerifier,
  createSpawnConfig,
  createCandidateTrajectories,
  PatchSearchRunner,
  type PatchCandidateExecutor,
  type PatchCandidateWorktreeManager,
} from '../PatchSearchRunner.js'
import type { PatchCandidateWorktree, PatchSearchRequest } from '../types.js'
import type { VerificationSummary } from '../../verification/index.js'
import type { PatchSearchFooterStatus } from '../types.js'

describe('PatchSearchRunner', () => {
  test('plans dry-run candidates without creating worktrees or spawning agents', async () => {
    let createCalls = 0
    const runner = new PatchSearchRunner({
      worktrees: {
        create: async () => {
          createCalls += 1
          throw new Error('should not create worktree in dry-run')
        },
        cleanup: async () => ({ ok: true }),
      },
    })

    const result = await runner.run(request({ maxCandidates: 2 }))

    expect(createCalls).toBe(0)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map(item => item.candidate.exitStatus)).toEqual([
      'planned',
      'planned',
    ])
    expect(
      result.candidates[0]?.candidate.executionLogs?.[0]?.message,
    ).toContain('Dry run planned candidate trajectory')
  })

  test('limits candidates by runner maximum and builds isolated trajectory prompts', async () => {
    const seen: Array<{ id: string; prompt: string; slug: string }> = []
    const runner = new PatchSearchRunner({
      maxCandidates: 2,
      executor: async trajectory => {
        seen.push({
          id: trajectory.id,
          prompt: trajectory.prompt,
          slug: trajectory.worktree.slug,
        })
        return {
          ok: true,
          candidate: {
            id: trajectory.id,
            exitStatus: 'completed',
            diffStats: { filesChanged: 1, insertions: 2, deletions: 0 },
            touchedFiles: [{ path: 'src/query.ts', status: 'modified' }],
          },
        }
      },
    })

    const result = await runner.run(
      request({
        id: 'patch search! runner',
        prompt: 'fix the query loop',
        maxCandidates: 5,
      }),
    )

    expect(result.candidates).toHaveLength(2)
    expect(seen).toEqual([
      {
        id: 'patch search! runner-candidate-1',
        prompt:
          'fix the query loop\n\nPatch Search candidate 1 of 2.\nWork only in the assigned isolated worktree.\nReturn a focused patch and do not modify the parent workspace.',
        slug: 'patch-search-patch-search-runner-1',
      },
      {
        id: 'patch search! runner-candidate-2',
        prompt:
          'fix the query loop\n\nPatch Search candidate 2 of 2.\nWork only in the assigned isolated worktree.\nReturn a focused patch and do not modify the parent workspace.',
        slug: 'patch-search-patch-search-runner-2',
      },
    ])
  })

  test('creates worktrees in execute mode and passes spawn config to the executor', async () => {
    const worktrees = fakeWorktrees()
    const spawnCwds: Array<string | undefined> = []
    const runner = new PatchSearchRunner({
      worktrees,
      verifier: async (_trajectory, candidate, context) => ({
        summary: verificationSummary({
          status: 'passed',
          total: context.request.verificationCommands?.length ?? 1,
          passed: context.request.verificationCommands?.length ?? 1,
          failed: 0,
          timedOut: 0,
        }),
        logs: [{ level: 'info', message: `verified ${candidate.id}` }],
      }),
      executor: async (trajectory, context) => {
        spawnCwds.push(context.spawnConfig.cwd)
        return {
          ok: true,
          candidate: {
            id: trajectory.id,
            diffStats: { filesChanged: 1, insertions: 3, deletions: 1 },
            touchedFiles: [{ path: 'src/query.ts', status: 'modified' }],
          },
          logs: [{ level: 'info', message: `ran ${context.mode}` }],
        }
      },
    })

    const result = await runner.run(
      request({
        mode: 'execute',
        cleanupWorktrees: true,
        maxCandidates: 2,
        verificationCommands: ['bun run typecheck', 'bun test'],
      }),
    )

    expect(worktrees.created.map(worktree => worktree.slug)).toEqual([
      'patch-search-patch-search-test-1',
      'patch-search-patch-search-test-2',
    ])
    expect(worktrees.cleaned).toEqual(['/tmp/patch-search-patch-search-test-2'])
    expect(spawnCwds).toEqual([
      '/tmp/patch-search-patch-search-test-1',
      '/tmp/patch-search-patch-search-test-2',
    ])
    const spawnConfig = createSpawnConfig({
      id: 'patch-search-test-candidate-1',
      index: 0,
      prompt: 'fix',
      worktree: {
        slug: 'patch-search-patch-search-test-1',
        path: '/tmp/patch-search-patch-search-test-1',
      },
    })
    expect(spawnConfig).toMatchObject({
      sandboxSessionId: 'patch-search-patch-search-test-candidate-1',
      sandboxTraceManifest:
        '/tmp/patch-search-patch-search-test-1/.deepcode/sandbox-traces/patch-search/patch-search-patch-search-test-candidate-1.sandbox.json',
    })
    expect(result.candidates[0]?.candidate.worktreePath).toContain('/tmp/')
    expect(
      result.candidates[0]?.candidate.executionLogs?.map(log => log.message),
    ).toContain('Preserved winning worktree for patch application review.')
    expect(result.candidates[0]?.summary.verificationStatus).toBe('passed')
  })

  test('verifies successful candidates and ranks all-pass before partial failures', async () => {
    const verificationCwds: string[] = []
    const statuses: PatchSearchFooterStatus[] = []
    const runner = new PatchSearchRunner({
      worktrees: fakeWorktrees(),
      onStatus: status => statuses.push(status),
      executor: async trajectory => ({
        ok: true,
        candidate: {
          id: trajectory.id,
          diffStats:
            trajectory.index === 0
              ? { filesChanged: 1, insertions: 2, deletions: 0 }
              : { filesChanged: 4, insertions: 80, deletions: 20 },
          touchedFiles: [{ path: 'src/query.ts', status: 'modified' }],
        },
      }),
      verifier: async (trajectory, candidate) => {
        verificationCwds.push(candidate.worktreePath ?? '')
        return {
          summary:
            trajectory.index === 0
              ? verificationSummary({
                  status: 'failed',
                  total: 3,
                  passed: 2,
                  failed: 1,
                  timedOut: 0,
                })
              : verificationSummary({
                  status: 'passed',
                  total: 3,
                  passed: 3,
                  failed: 0,
                  timedOut: 0,
                }),
        }
      },
    })

    const result = await runner.run(
      request({ mode: 'execute', maxCandidates: 2 }),
    )

    expect(verificationCwds).toEqual([
      '/tmp/patch-search-patch-search-test-1',
      '/tmp/patch-search-patch-search-test-2',
    ])
    expect(result.winner?.candidate.id).toBe('patch-search-test-candidate-2')
    expect(
      result.summary.candidates.map(item => item.verificationStatus),
    ).toEqual(['passed', 'failed'])
    expect(statuses.map(status => status.phase)).toContain('running')
    expect(statuses.map(status => status.phase)).toContain('verifying')
    expect(statuses.map(status => status.phase)).toContain('selecting')
    expect(statuses.map(status => status.phase)).toContain('applying')
    expect(statuses.at(-1)).toMatchObject({
      phase: 'failed',
      requestId: 'patch-search-test',
      candidateCount: 2,
      selectedCandidateId: 'patch-search-test-candidate-2',
    })
  })

  test('ranks partial failures by fewer failures, then diff size, risk, and target coverage', async () => {
    const runner = new PatchSearchRunner({
      worktrees: fakeWorktrees(),
      executor: async trajectory => ({
        ok: true,
        candidate: {
          id: trajectory.id,
          riskFlags: trajectory.index === 2 ? ['high_risk_file'] : undefined,
          diffStats:
            trajectory.index === 0
              ? { filesChanged: 1, insertions: 1, deletions: 0 }
              : trajectory.index === 1
                ? { filesChanged: 5, insertions: 40, deletions: 10 }
                : { filesChanged: 1, insertions: 1, deletions: 0 },
          touchedFiles:
            trajectory.index === 2
              ? [{ path: 'src/query.ts', status: 'modified' }]
              : [{ path: 'src/other.ts', status: 'modified' }],
        },
      }),
      verifier: async trajectory => ({
        summary:
          trajectory.index === 1
            ? verificationSummary({
                status: 'failed',
                total: 3,
                passed: 1,
                failed: 2,
                timedOut: 0,
              })
            : verificationSummary({
                status: 'failed',
                total: 3,
                passed: 2,
                failed: 1,
                timedOut: 0,
              }),
      }),
    })

    const result = await runner.run(
      request({ mode: 'execute', maxCandidates: 3 }),
    )

    expect(result.candidates.map(item => item.candidate.id)).toEqual([
      'patch-search-test-candidate-1',
      'patch-search-test-candidate-3',
      'patch-search-test-candidate-2',
    ])
    expect(
      result.candidates.map(item => item.summary.verificationFailureCount),
    ).toEqual([1, 1, 2])
  })

  test('records verifier crashes as structured retryable candidate failures', async () => {
    const runner = new PatchSearchRunner({
      worktrees: fakeWorktrees(),
      executor: async trajectory => ({
        ok: true,
        candidate: {
          id: trajectory.id,
          diffStats: { filesChanged: 1, insertions: 4, deletions: 0 },
          touchedFiles: [{ path: 'src/query.ts', status: 'modified' }],
        },
      }),
      verifier: async () => {
        throw new Error('verification runner crashed')
      },
    })

    const result = await runner.run(
      request({ mode: 'execute', maxCandidates: 1 }),
    )

    expect(result.winner?.candidate.failure).toEqual({
      kind: 'verification_failed',
      message: 'verification runner crashed',
      retryable: true,
    })
    expect(result.winner?.summary.failure?.kind).toBe('verification_failed')
    expect(result.winner?.summary.riskFlags).toContain('verification_failed')
  })

  test('default verifier records sandbox manifests on candidates and summaries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'patch-search-sandbox-'))
    const verifier = createDefaultCandidateVerifier()
    const trajectory = createCandidateTrajectories(
      request({ id: 'patch sandbox', maxCandidates: 1 }),
    )[0]!
    const candidate = {
      id: trajectory.id,
      worktreePath: cwd,
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
      touchedFiles: [{ path: 'src/query.ts', status: 'modified' as const }],
    }

    const verification = await verifier(trajectory, candidate, {
      request: request({
        id: 'patch sandbox',
        mode: 'execute',
        verificationCommands: ['bun --version'],
      }),
      mode: 'execute',
    })

    expect(verification.summary?.status).toBe('passed')
    expect(verification.sandbox).toMatchObject({
      sessionId: 'patch-search-patch-sandbox-patch-sandbox-candidate-1',
      commandCount: 1,
      policyViolationCount: 0,
    })
    const manifestPath = verification.sandbox?.manifestPaths[0] ?? ''
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      purpose: string
      metadata: Record<string, string>
    }
    expect(manifest).toMatchObject({
      purpose: 'patch-search-verification',
      metadata: {
        patchSearchRequestId: 'patch sandbox',
        patchSearchCandidateId: 'patch sandbox-candidate-1',
      },
    })
  })

  test('keeps structured failed candidates when worktree creation or execution fails', async () => {
    const executor: PatchCandidateExecutor = async trajectory => {
      if (trajectory.index === 1) {
        throw new Error('agent process crashed')
      }
      return {
        ok: false,
        failure: {
          kind: 'agent_spawn_failed',
          message: 'agent refused to start',
          retryable: true,
        },
      }
    }
    const runner = new PatchSearchRunner({
      worktrees: {
        create: async trajectory => {
          if (trajectory.index === 0) {
            throw new Error('git worktree unavailable')
          }
          return {
            slug: trajectory.worktree.slug,
            path: `/tmp/${trajectory.worktree.slug}`,
          }
        },
        cleanup: async () => ({ ok: true }),
      },
      executor,
    })

    const result = await runner.run(
      request({ mode: 'execute', maxCandidates: 3 }),
    )

    expect(result.candidates.map(item => item.candidate.failure?.kind)).toEqual(
      ['worktree_create_failed', 'executor_failed', 'agent_spawn_failed'],
    )
    expect(result.summary.candidates.map(item => item.failure?.kind)).toEqual([
      'worktree_create_failed',
      'executor_failed',
      'agent_spawn_failed',
    ])
    expect(result.candidates.map(item => item.candidate.exitStatus)).toEqual([
      'failed',
      'failed',
      'failed',
    ])
  })
})

describe('createCandidateTrajectories', () => {
  test('returns stable candidate ids, slugs, and prompts', () => {
    expect(
      createCandidateTrajectories(
        request({ id: 'repair query', prompt: 'fix it', maxCandidates: 2 }),
      ),
    ).toEqual([
      {
        id: 'repair query-candidate-1',
        index: 0,
        prompt:
          'fix it\n\nPatch Search candidate 1 of 2.\nWork only in the assigned isolated worktree.\nReturn a focused patch and do not modify the parent workspace.',
        worktree: { slug: 'patch-search-repair-query-1' },
      },
      {
        id: 'repair query-candidate-2',
        index: 1,
        prompt:
          'fix it\n\nPatch Search candidate 2 of 2.\nWork only in the assigned isolated worktree.\nReturn a focused patch and do not modify the parent workspace.',
        worktree: { slug: 'patch-search-repair-query-2' },
      },
    ])
  })
})

function request(
  overrides: Partial<PatchSearchRequest> = {},
): PatchSearchRequest {
  return {
    id: 'patch-search-test',
    prompt: 'fix the bug',
    maxCandidates: 3,
    targetFiles: [{ path: 'src/query.ts' }],
    ...overrides,
  }
}

function fakeWorktrees(): PatchCandidateWorktreeManager & {
  created: PatchCandidateWorktree[]
  cleaned: string[]
} {
  const created: PatchCandidateWorktree[] = []
  const cleaned: string[] = []

  return {
    created,
    cleaned,
    create: async trajectory => {
      const worktree = {
        slug: trajectory.worktree.slug,
        path: `/tmp/${trajectory.worktree.slug}`,
        branchName: `worktree-${trajectory.worktree.slug}`,
        baseCommit: `base-${trajectory.index}`,
        gitRoot: '/repo',
      }
      created.push(worktree)
      return worktree
    },
    cleanup: async trajectory => {
      if (trajectory.worktree.path) {
        cleaned.push(trajectory.worktree.path)
      }
      return {
        ok: true,
        logs: [
          {
            level: 'info',
            message: `removed ${trajectory.worktree.path}`,
          },
        ],
      }
    },
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
