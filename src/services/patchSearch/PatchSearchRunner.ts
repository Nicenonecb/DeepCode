import { join } from 'node:path'
import {
  createAgenticSandboxVerificationExecutor,
  type AgenticSandboxTraceBundle,
  type AgenticSandboxTraceRef,
} from '../agenticSandbox/index.js'
import { createSandboxTraceBundle } from '../benchmark/TaskDataset.js'
import type { SpawnTeammateConfig } from '../../../packages/builtin-tools/src/tools/shared/spawnMultiAgent.js'
import {
  createAgentWorktree,
  removeAgentWorktree,
} from '../../utils/worktree.js'
import {
  VerificationRunner,
  type VerificationRunnerSettings,
  type VerificationSummary,
} from '../verification/index.js'
import { rankPatchCandidates } from './CandidateEvaluator.js'
import {
  attachPatchApplication,
  PatchApplicator,
  type PatchApplicationGitRunner,
} from './PatchApplicator.js'
import {
  createPatchSearchResultStatus,
  createPatchSearchRunningStatus,
} from './PatchSearchStatus.js'
import type {
  PatchCandidate,
  PatchCandidateExecutionLog,
  PatchCandidateFailure,
  PatchCandidateTrajectory,
  PatchCandidateWorktree,
  PatchSearchFooterStatus,
  PatchSearchMode,
  PatchSearchRequest,
  PatchSearchResult,
} from './types.js'

const DEFAULT_MAX_CANDIDATES = 3
const HARD_MAX_CANDIDATES = 8

export type PatchSearchRunnerOptions = {
  executor?: PatchCandidateExecutor
  verifier?: PatchCandidateVerifier
  worktrees?: PatchCandidateWorktreeManager
  applicator?: PatchApplicationPlanner
  onStatus?: PatchSearchStatusSink
  maxCandidates?: number
}

export type PatchSearchStatusSink = (status: PatchSearchFooterStatus) => void

export type PatchApplicationPlanner = (
  result: PatchSearchResult,
  request: PatchSearchRequest,
) => Promise<NonNullable<PatchSearchResult['application']>>

export type PatchCandidateExecutor = (
  trajectory: PatchCandidateTrajectory,
  context: PatchCandidateExecutorContext,
) => Promise<PatchCandidateExecution>

export type PatchCandidateCleanup = (
  trajectory: PatchCandidateTrajectory,
  candidate: PatchCandidate | undefined,
) => Promise<PatchCandidateCleanupResult>

export type PatchCandidateVerifier = (
  trajectory: PatchCandidateTrajectory,
  candidate: PatchCandidate,
  context: PatchCandidateVerifierContext,
) => Promise<PatchCandidateVerificationResult>

export type PatchCandidateWorktreeManager = {
  create: (
    trajectory: PatchCandidateTrajectory,
  ) => Promise<PatchCandidateWorktree>
  cleanup: PatchCandidateCleanup
}

export type PatchCandidateExecutorContext = {
  request: PatchSearchRequest
  mode: PatchSearchMode
  spawnConfig: SpawnTeammateConfig
}

export type PatchCandidateVerifierContext = {
  request: PatchSearchRequest
  mode: PatchSearchMode
}

export type PatchCandidateExecution =
  | {
      ok: true
      candidate: PatchCandidate
      logs?: PatchCandidateExecutionLog[]
    }
  | {
      ok: false
      failure: PatchCandidateFailure
      logs?: PatchCandidateExecutionLog[]
    }

export type PatchCandidateCleanupResult = {
  ok: boolean
  failure?: PatchCandidateFailure
  logs?: PatchCandidateExecutionLog[]
}

export type PatchCandidateVerificationResult = {
  summary?: VerificationSummary
  failure?: PatchCandidateFailure
  logs?: PatchCandidateExecutionLog[]
  sandbox?: AgenticSandboxTraceBundle
}

export class PatchSearchRunner {
  private readonly executor: PatchCandidateExecutor
  private readonly verifier: PatchCandidateVerifier
  private readonly worktrees: PatchCandidateWorktreeManager
  private readonly applicator: PatchApplicationPlanner
  private readonly onStatus?: PatchSearchStatusSink
  private readonly maxCandidates: number

  constructor(options: PatchSearchRunnerOptions = {}) {
    this.executor = options.executor ?? dryRunCandidateExecutor
    this.verifier = options.verifier ?? createDefaultCandidateVerifier()
    this.worktrees = options.worktrees ?? createDefaultWorktreeManager()
    this.applicator = options.applicator ?? createDefaultApplicationPlanner()
    this.onStatus = options.onStatus
    this.maxCandidates = normalizeMaxCandidates(options.maxCandidates)
  }

  async run(request: PatchSearchRequest): Promise<PatchSearchResult> {
    const normalizedRequest = normalizeRequest(request, this.maxCandidates)
    this.emitStatus(
      createPatchSearchRunningStatus(normalizedRequest, 'running'),
    )
    const trajectories = createCandidateTrajectories(normalizedRequest)
    const executions = await Promise.all(
      trajectories.map(trajectory =>
        this.runTrajectory(normalizedRequest, trajectory),
      ),
    )
    const candidates = executions.map(execution => execution.candidate)

    this.emitStatus(
      createPatchSearchRunningStatus(normalizedRequest, 'selecting'),
    )
    const ranked = rankPatchCandidates(normalizedRequest, candidates)
    this.emitStatus(createPatchSearchResultStatus(ranked, 'applying'))
    const application = await this.applicator(ranked, normalizedRequest)
    const result = attachPatchApplication(ranked, application)
    this.emitStatus(
      createPatchSearchResultStatus(
        result,
        application.status === 'blocked' ? 'failed' : 'completed',
      ),
    )

    return normalizedRequest.cleanupWorktrees === true
      ? this.cleanupCandidates(executions, result)
      : result
  }

  private async runTrajectory(
    request: PatchSearchRequest,
    trajectory: PatchCandidateTrajectory,
  ): Promise<{
    trajectory: PatchCandidateTrajectory
    candidate: PatchCandidate
  }> {
    let candidate: PatchCandidate | undefined
    const logs: PatchCandidateExecutionLog[] = []

    try {
      if (request.mode === 'execute') {
        try {
          trajectory = {
            ...trajectory,
            worktree: await this.worktrees.create(trajectory),
          }
        } catch (error) {
          candidate = failedCandidate(
            trajectory,
            {
              kind: 'worktree_create_failed',
              message: errorMessage(error),
              retryable: true,
            },
            logs,
          )
          return { trajectory, candidate }
        }
      }
      const execution = await this.executor(trajectory, {
        request,
        mode: request.mode ?? 'dry_run',
        spawnConfig: createSpawnConfig(trajectory),
      })
      logs.push(...(execution.logs ?? []))

      candidate = execution.ok
        ? normalizeCandidate(trajectory, execution.candidate, logs)
        : failedCandidate(trajectory, execution.failure, logs)
    } catch (error) {
      candidate = failedCandidate(
        trajectory,
        {
          kind: 'executor_failed',
          message: errorMessage(error),
          retryable: true,
        },
        logs,
      )
    }

    candidate = await this.verifyCandidate(request, trajectory, candidate, logs)

    return { trajectory, candidate }
  }

  private async cleanupCandidates(
    executions: Array<{
      trajectory: PatchCandidateTrajectory
      candidate: PatchCandidate
    }>,
    result: PatchSearchResult,
  ): Promise<PatchSearchResult> {
    const winnerId = result.winner?.candidate.id
    const updatedCandidates = new Map<string, PatchCandidate>()

    for (const execution of executions) {
      const { trajectory, candidate } = execution
      const logs = [...(candidate.executionLogs ?? [])]

      if (candidate.id === winnerId) {
        logs.push({
          level: 'info',
          message: 'Preserved winning worktree for patch application review.',
        })
        updatedCandidates.set(candidate.id, {
          ...candidate,
          executionLogs: logs,
        })
        continue
      }

      const cleanupResult = await this.worktrees.cleanup(trajectory, candidate)
      logs.push(...(cleanupResult.logs ?? []))
      updatedCandidates.set(
        candidate.id,
        !cleanupResult.ok && cleanupResult.failure
          ? {
              ...candidate,
              executionLogs: logs,
              failure: cleanupResult.failure,
              riskFlags: mergeRiskFlags(candidate.riskFlags, [
                'high_risk_file',
              ]),
            }
          : {
              ...candidate,
              executionLogs: logs,
            },
      )
    }

    const candidates = result.candidates.map(evaluation => {
      const candidate =
        updatedCandidates.get(evaluation.candidate.id) ?? evaluation.candidate
      return {
        ...evaluation,
        candidate,
        summary: {
          ...evaluation.summary,
          ...(candidate.failure ? { failure: candidate.failure } : {}),
        },
      }
    })
    const winner = candidates.find(
      evaluation => evaluation.candidate.id === winnerId,
    )

    return {
      ...result,
      candidates,
      winner,
      summary: {
        ...result.summary,
        candidates: candidates.map(evaluation => evaluation.summary),
      },
    }
  }

  private async verifyCandidate(
    request: PatchSearchRequest,
    trajectory: PatchCandidateTrajectory,
    candidate: PatchCandidate,
    logs: PatchCandidateExecutionLog[],
  ): Promise<PatchCandidate> {
    if (candidate.exitStatus === 'failed' || request.mode !== 'execute') {
      return candidate
    }

    try {
      this.emitStatus(createPatchSearchRunningStatus(request, 'verifying'))
      const verification = await this.verifier(trajectory, candidate, {
        request,
        mode: request.mode ?? 'dry_run',
      })
      logs.push(...(verification.logs ?? []))

      return {
        ...candidate,
        verificationSummary:
          verification.summary ?? candidate.verificationSummary,
        sandbox: verification.sandbox ?? candidate.sandbox,
        failure: verification.failure ?? candidate.failure,
        executionLogs: logs,
        riskFlags: verification.failure
          ? mergeRiskFlags(candidate.riskFlags, ['verification_failed'])
          : candidate.riskFlags,
      }
    } catch (error) {
      return {
        ...candidate,
        failure: {
          kind: 'verification_failed',
          message: errorMessage(error),
          retryable: true,
        },
        executionLogs: logs,
        riskFlags: mergeRiskFlags(candidate.riskFlags, ['verification_failed']),
      }
    }
  }

  private emitStatus(status: PatchSearchFooterStatus): void {
    this.onStatus?.(status)
  }
}

export function createDefaultWorktreeManager(): PatchCandidateWorktreeManager {
  return {
    async create(trajectory) {
      const worktree = await createAgentWorktree(trajectory.worktree.slug)
      return {
        slug: trajectory.worktree.slug,
        path: worktree.worktreePath,
        branchName: worktree.worktreeBranch,
        baseCommit: worktree.headCommit,
        gitRoot: worktree.gitRoot,
        hookBased: worktree.hookBased,
      }
    },
    async cleanup(trajectory) {
      if (!trajectory.worktree.path) {
        return noopCandidateCleanup()
      }

      const ok = await removeAgentWorktree(
        trajectory.worktree.path,
        trajectory.worktree.branchName,
        trajectory.worktree.gitRoot,
        trajectory.worktree.hookBased,
      )

      return ok
        ? {
            ok: true,
            logs: [
              {
                level: 'info',
                message: `Removed worktree ${trajectory.worktree.path}.`,
              },
            ],
          }
        : {
            ok: false,
            failure: {
              kind: 'cleanup_failed',
              message: `Failed to remove worktree ${trajectory.worktree.path}.`,
              retryable: true,
            },
          }
    },
  }
}

export function createDefaultCandidateVerifier(): PatchCandidateVerifier {
  return async (_trajectory, candidate, context) => {
    const cwd = candidate.worktreePath
    if (!cwd) {
      return {
        logs: [
          {
            level: 'warning',
            message:
              'Skipped verification because the candidate has no worktree path.',
          },
        ],
      }
    }

    const settings = verificationSettingsFor(context.request)
    const sandboxSessionId = sanitizeSessionId(
      `patch-search-${context.request.id}-${candidate.id}`,
    )
    const sandboxTraces: AgenticSandboxTraceRef[] = []
    const summary = await new VerificationRunner({
      cwd,
      settings,
      executor: createAgenticSandboxVerificationExecutor({
        sessionId: sandboxSessionId,
        purpose: 'patch-search-verification',
        traceDir: join(cwd, '.deepcode', 'sandbox-traces', 'patch-search'),
        metadata: {
          patchSearchRequestId: context.request.id,
          patchSearchCandidateId: candidate.id,
          patchSearchMode: context.mode,
        },
        onTrace: trace => sandboxTraces.push(trace),
      }),
    }).run()
    const sandbox = createSandboxTraceBundle(sandboxSessionId, sandboxTraces)
    return {
      summary,
      sandbox,
      logs: [
        {
          level: 'info',
          message: `Verification completed with status ${summary.status}.`,
        },
        {
          level: 'info',
          message: `Sandbox trace recorded ${sandbox.manifestPaths.length} manifest(s) for ${candidate.id}.`,
        },
      ],
    }
  }
}

export function createDefaultApplicationPlanner(
  git?: PatchApplicationGitRunner,
): PatchApplicationPlanner {
  const applicator = new PatchApplicator({ git })
  return (result, request) => applicator.applyWinner(result, request)
}

export function createCandidateTrajectories(
  request: PatchSearchRequest,
): PatchCandidateTrajectory[] {
  return Array.from({ length: request.maxCandidates }, (_, index) => {
    const id = `${request.id}-candidate-${index + 1}`
    return {
      id,
      index,
      prompt: buildCandidatePrompt(request, index),
      worktree: {
        slug: `patch-search-${sanitizeSlug(request.id)}-${index + 1}`,
      },
    }
  })
}

export function createSpawnConfig(
  trajectory: PatchCandidateTrajectory,
): SpawnTeammateConfig {
  const sandboxSessionId = sanitizeSessionId(`patch-search-${trajectory.id}`)
  const sandboxTraceManifest = trajectory.worktree.path
    ? join(
        trajectory.worktree.path,
        '.deepcode',
        'sandbox-traces',
        'patch-search',
        `${sandboxSessionId}.sandbox.json`,
      )
    : undefined
  return {
    name: trajectory.id,
    prompt: trajectory.prompt,
    cwd: trajectory.worktree.path,
    team_name: 'patch-search',
    agent_type: 'worker',
    description: 'Patch Search candidate trajectory',
    sandboxSessionId,
    ...(sandboxTraceManifest ? { sandboxTraceManifest } : {}),
  }
}

async function dryRunCandidateExecutor(
  trajectory: PatchCandidateTrajectory,
  context: PatchCandidateExecutorContext,
): Promise<PatchCandidateExecution> {
  return {
    ok: true,
    candidate: {
      id: trajectory.id,
      label: `Candidate ${trajectory.index + 1}`,
      worktreePath: trajectory.worktree.path,
      branchName: trajectory.worktree.branchName,
      baseCommit: trajectory.worktree.baseCommit,
      exitStatus: 'planned',
      diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
      touchedFiles: [],
      targetFiles: context.request.targetFiles,
      riskFlags: ['empty_diff'],
    },
    logs: [
      {
        level: 'info',
        message:
          'Dry run planned candidate trajectory without creating a worktree or spawning an agent.',
      },
    ],
  }
}

async function noopCandidateCleanup(): Promise<PatchCandidateCleanupResult> {
  return {
    ok: true,
    logs: [{ level: 'info', message: 'No worktree cleanup required.' }],
  }
}

function normalizeRequest(
  request: PatchSearchRequest,
  runnerMaxCandidates: number,
): PatchSearchRequest {
  const requested = normalizeMaxCandidates(request.maxCandidates)
  const maxCandidates = Math.min(requested, runnerMaxCandidates)
  return {
    ...request,
    mode: request.mode ?? 'dry_run',
    cleanupWorktrees: request.cleanupWorktrees ?? false,
    maxCandidates,
  }
}

function normalizeMaxCandidates(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return DEFAULT_MAX_CANDIDATES
  }
  return Math.max(1, Math.min(Math.floor(value), HARD_MAX_CANDIDATES))
}

function verificationSettingsFor(
  request: PatchSearchRequest,
): VerificationRunnerSettings {
  return {
    enabled: true,
    commands: request.verificationCommands,
  }
}

function normalizeCandidate(
  trajectory: PatchCandidateTrajectory,
  candidate: PatchCandidate,
  logs: PatchCandidateExecutionLog[],
): PatchCandidate {
  return {
    ...candidate,
    id: candidate.id || trajectory.id,
    worktreePath: candidate.worktreePath ?? trajectory.worktree.path,
    branchName: candidate.branchName ?? trajectory.worktree.branchName,
    baseCommit: candidate.baseCommit ?? trajectory.worktree.baseCommit,
    exitStatus: candidate.exitStatus ?? 'completed',
    executionLogs: [...(candidate.executionLogs ?? []), ...logs],
  }
}

function failedCandidate(
  trajectory: PatchCandidateTrajectory,
  failure: PatchCandidateFailure,
  logs: PatchCandidateExecutionLog[],
): PatchCandidate {
  return {
    id: trajectory.id,
    label: `Candidate ${trajectory.index + 1}`,
    worktreePath: trajectory.worktree.path,
    branchName: trajectory.worktree.branchName,
    baseCommit: trajectory.worktree.baseCommit,
    exitStatus: 'failed',
    executionLogs: logs,
    failure,
    diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    touchedFiles: [],
    riskFlags: ['empty_diff'],
  }
}

function buildCandidatePrompt(
  request: PatchSearchRequest,
  candidateIndex: number,
): string {
  return [
    request.prompt,
    '',
    `Patch Search candidate ${candidateIndex + 1} of ${request.maxCandidates}.`,
    'Work only in the assigned isolated worktree.',
    'Return a focused patch and do not modify the parent workspace.',
  ].join('\n')
}

function sanitizeSlug(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '')
  return sanitized.slice(0, 40) || 'candidate'
}

function sanitizeSessionId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 96) || 'sandbox'
  )
}

function mergeRiskFlags(
  current: PatchCandidate['riskFlags'],
  next: PatchCandidate['riskFlags'],
): PatchCandidate['riskFlags'] {
  return [...new Set([...(current ?? []), ...(next ?? [])])].sort()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
