import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { gitExe } from '../../utils/git.js'
import type {
  PatchApplicationCommand,
  PatchApplicationIssue,
  PatchApplicationMode,
  PatchApplicationRequest,
  PatchApplicationSummary,
  PatchCandidate,
  PatchSearchRequest,
  PatchSearchResult,
} from './types.js'

const DEFAULT_PATCH_FILE_NAME = 'patch-search-winner.patch'

export type PatchApplicationGitRunner = (
  cwd: string,
  args: string[],
  input?: string,
) => Promise<PatchApplicationGitResult>

export type PatchApplicationGitResult = {
  code: number
  stdout: string
  stderr: string
  error?: string
}

export type PatchApplicatorOptions = {
  git?: PatchApplicationGitRunner
  mainWorktreePath?: string
}

type Preflight = {
  mode: PatchApplicationMode
  candidate: PatchCandidate
  mainWorktreePath: string
  candidateWorktreePath: string
  patchFilePath: string
  patch: string
  issues: PatchApplicationIssue[]
  dirtyFiles: string[]
  conflictingFiles: string[]
  commands: PatchApplicationCommand[]
}

export class PatchApplicator {
  private readonly git: PatchApplicationGitRunner
  private readonly mainWorktreePath: string

  constructor(options: PatchApplicatorOptions = {}) {
    this.git = options.git ?? defaultGitRunner
    this.mainWorktreePath = options.mainWorktreePath ?? process.cwd()
  }

  async applyWinner(
    result: PatchSearchResult,
    request: PatchSearchRequest,
  ): Promise<PatchApplicationSummary> {
    const mode = request.patchApplication?.mode ?? 'recommend'
    const winner = result.winner?.candidate
    if (!winner) {
      return blockedSummary({
        mode,
        patchSize: 0,
        message: 'No patch candidate was selected.',
        issues: [
          {
            kind: 'no_winner',
            message: 'No patch candidate was selected.',
            retryable: false,
          },
        ],
      })
    }

    const preflight = await this.preflight(winner, request, mode)
    const hardBlockers = blockingIssues(preflight.issues, request)
    if (hardBlockers.length > 0) {
      return summaryForPreflight(preflight, {
        status: 'blocked',
        applied: false,
        message: hardBlockers[0]?.message ?? 'Patch application is blocked.',
      })
    }

    if (mode === 'recommend') {
      return summaryForPreflight(preflight, {
        status: 'recommended',
        applied: false,
        message:
          'Patch candidate is ready for review; run the recommended commands to apply it manually.',
      })
    }

    const check = await this.git(
      preflight.mainWorktreePath,
      ['apply', '--check', '-'],
      preflight.patch,
    )
    if (check.code !== 0) {
      return summaryForPreflight(
        addIssue(preflight, {
          kind: 'patch_check_failed',
          message:
            commandMessage(check) ??
            'Git rejected the patch during dry-run apply.',
          retryable: true,
        }),
        {
          status: 'blocked',
          applied: false,
          message:
            'Patch application is blocked because git apply --check failed.',
        },
      )
    }

    const apply = await this.git(
      preflight.mainWorktreePath,
      ['apply', '-'],
      preflight.patch,
    )
    if (apply.code !== 0) {
      return summaryForPreflight(
        addIssue(preflight, {
          kind: 'apply_failed',
          message:
            commandMessage(apply) ?? 'Git failed while applying the patch.',
          retryable: true,
        }),
        {
          status: 'blocked',
          applied: false,
          message:
            'Patch application failed; the main worktree was not overwritten by this layer.',
        },
      )
    }

    return summaryForPreflight(preflight, {
      status: 'applied',
      applied: true,
      message: 'Patch applied to the main worktree.',
    })
  }

  private async preflight(
    candidate: PatchCandidate,
    request: PatchSearchRequest,
    mode: PatchApplicationMode,
  ): Promise<Preflight> {
    const appRequest = request.patchApplication
    const mainWorktreePath =
      appRequest?.mainWorktreePath ?? this.mainWorktreePath
    const candidateWorktreePath = candidate.worktreePath ?? ''
    const patchFilePath =
      appRequest?.patchFilePath ??
      join(tmpdir(), `${safeFileName(candidate.id)}-${DEFAULT_PATCH_FILE_NAME}`)
    const issues: PatchApplicationIssue[] = []

    if (!candidateWorktreePath) {
      issues.push({
        kind: 'missing_worktree',
        message: 'Selected candidate has no worktree path to diff from.',
        retryable: false,
      })
    }

    if (candidate.verificationSummary?.status !== undefined) {
      if (candidate.verificationSummary.status !== 'passed') {
        issues.push({
          kind: 'verification_failed',
          message: `Selected candidate verification status is ${candidate.verificationSummary.status}.`,
          retryable: true,
        })
      }
    }

    let dirtyFiles: string[] = []
    let conflictingFiles: string[] = []
    let patch = ''

    if (candidateWorktreePath) {
      const [status, head, diff] = await Promise.all([
        this.git(mainWorktreePath, ['status', '--porcelain']),
        this.git(mainWorktreePath, ['rev-parse', 'HEAD']),
        this.git(candidateWorktreePath, [
          'diff',
          candidate.baseCommit ?? 'HEAD',
        ]),
      ])

      if (status.code === 0) {
        dirtyFiles = parsePorcelainFiles(status.stdout)
        conflictingFiles = targetConflicts(dirtyFiles, candidate, request)
      } else {
        issues.push({
          kind: 'git_status_failed',
          message:
            commandMessage(status) ??
            'Could not inspect the main worktree dirty state.',
          retryable: true,
        })
      }

      if (head.code === 0) {
        const mainHead = head.stdout.trim()
        if (candidate.baseCommit && candidate.baseCommit !== mainHead) {
          issues.push({
            kind: 'base_mismatch',
            message: `Main worktree HEAD ${mainHead} does not match candidate base ${candidate.baseCommit}.`,
            retryable: true,
            details: {
              mainHead,
              candidateBaseCommit: candidate.baseCommit,
            },
          })
        }
      } else {
        issues.push({
          kind: 'head_read_failed',
          message:
            commandMessage(head) ??
            'Could not read the main worktree HEAD commit.',
          retryable: true,
        })
      }

      if (diff.code === 0) {
        patch = diff.stdout
        if (patch.trim().length === 0) {
          issues.push({
            kind: 'empty_diff',
            message: 'Selected candidate produced an empty patch.',
            retryable: false,
          })
        }
      } else {
        issues.push({
          kind: 'diff_collection_failed',
          message:
            commandMessage(diff) ??
            'Could not collect a patch from the selected candidate worktree.',
          retryable: true,
        })
      }
    }

    if (dirtyFiles.length > 0) {
      issues.push({
        kind: 'dirty_worktree',
        message: 'Main worktree has uncommitted changes.',
        retryable: true,
        details: { fileCount: dirtyFiles.length },
      })
    }

    if (conflictingFiles.length > 0) {
      issues.push({
        kind: 'target_conflict',
        message:
          'Main worktree has uncommitted changes in files touched by the selected candidate.',
        retryable: true,
        details: { fileCount: conflictingFiles.length },
      })
    }

    return {
      mode,
      candidate,
      mainWorktreePath,
      candidateWorktreePath,
      patchFilePath,
      patch,
      issues,
      dirtyFiles,
      conflictingFiles,
      commands: buildApplicationCommands({
        mainWorktreePath,
        candidateWorktreePath,
        patchFilePath,
        baseCommit: candidate.baseCommit,
      }),
    }
  }
}

export function attachPatchApplication(
  result: PatchSearchResult,
  application: PatchApplicationSummary,
): PatchSearchResult {
  return {
    ...result,
    application,
    summary: {
      ...result.summary,
      application,
    },
  }
}

function blockingIssues(
  issues: PatchApplicationIssue[],
  request: PatchSearchRequest,
): PatchApplicationIssue[] {
  const appRequest = request.patchApplication
  const mode = appRequest?.mode ?? 'recommend'

  return issues.filter(issue => {
    if (issue.kind === 'no_winner') return true
    if (issue.kind === 'missing_worktree') return true
    if (issue.kind === 'empty_diff') return true
    if (issue.kind === 'diff_collection_failed') return true
    if (mode === 'recommend') return false
    if (issue.kind === 'dirty_worktree') {
      return appRequest?.allowDirtyWorkingTree !== true
    }
    if (issue.kind === 'target_conflict') {
      return appRequest?.allowTargetConflicts !== true
    }
    if (issue.kind === 'base_mismatch') {
      return appRequest?.allowBaseMismatch !== true
    }
    if (issue.kind === 'verification_failed') {
      return appRequest?.allowFailedVerification !== true
    }
    return (
      issue.kind === 'git_status_failed' || issue.kind === 'head_read_failed'
    )
  })
}

function buildApplicationCommands({
  mainWorktreePath,
  candidateWorktreePath,
  patchFilePath,
  baseCommit,
}: {
  mainWorktreePath: string
  candidateWorktreePath: string
  patchFilePath: string
  baseCommit?: string
}): PatchApplicationCommand[] {
  const baseRef = baseCommit ?? 'HEAD'
  return [
    {
      description: 'Write the selected candidate diff to a patch file',
      command: `git -C ${quoteShell(candidateWorktreePath)} diff ${quoteShell(baseRef)} -- > ${quoteShell(patchFilePath)}`,
    },
    {
      description: 'Check whether the patch applies cleanly',
      command: `git -C ${quoteShell(mainWorktreePath)} apply --check ${quoteShell(patchFilePath)}`,
    },
    {
      description: 'Apply the patch to the main worktree',
      command: `git -C ${quoteShell(mainWorktreePath)} apply ${quoteShell(patchFilePath)}`,
    },
  ]
}

function summaryForPreflight(
  preflight: Preflight,
  status: Pick<PatchApplicationSummary, 'status' | 'applied' | 'message'>,
): PatchApplicationSummary {
  return {
    ...status,
    mode: preflight.mode,
    candidateId: preflight.candidate.id,
    mainWorktreePath: preflight.mainWorktreePath,
    candidateWorktreePath: preflight.candidateWorktreePath,
    patchFilePath: preflight.patchFilePath,
    patchSize: preflight.patch.length,
    commands: preflight.commands,
    issues: preflight.issues,
    dirtyFiles: preflight.dirtyFiles,
    conflictingFiles: preflight.conflictingFiles,
  }
}

function blockedSummary({
  mode,
  patchSize,
  message,
  issues,
}: {
  mode: PatchApplicationMode
  patchSize: number
  message: string
  issues: PatchApplicationIssue[]
}): PatchApplicationSummary {
  return {
    status: 'blocked',
    mode,
    patchSize,
    applied: false,
    message,
    commands: [],
    issues,
    dirtyFiles: [],
    conflictingFiles: [],
  }
}

function addIssue(
  preflight: Preflight,
  issue: PatchApplicationIssue,
): Preflight {
  return {
    ...preflight,
    issues: [...preflight.issues, issue],
  }
}

function targetConflicts(
  dirtyFiles: string[],
  candidate: PatchCandidate,
  request: PatchSearchRequest,
): string[] {
  const touched = new Set([
    ...candidate.touchedFiles.map(file => normalizeGitPath(file.path)),
    ...(request.targetFiles ?? []).map(file => normalizeGitPath(file.path)),
  ])
  return dirtyFiles
    .map(normalizeGitPath)
    .filter(file => touched.has(file))
    .sort()
}

function parsePorcelainFiles(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .flatMap(line => {
      const file = line.slice(3)
      const renameSeparator = ' -> '
      if (file.includes(renameSeparator)) {
        const [from, to] = file.split(renameSeparator)
        return [from, to].filter(isString)
      }
      return [file]
    })
    .map(normalizeGitPath)
    .sort()
}

function normalizeGitPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function commandMessage(result: PatchApplicationGitResult): string | undefined {
  return (
    result.error || result.stderr.trim() || result.stdout.trim() || undefined
  )
}

function safeFileName(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'patch'
  )
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

async function defaultGitRunner(
  cwd: string,
  args: string[],
  input?: string,
): Promise<PatchApplicationGitResult> {
  return execFileNoThrowWithCwd(gitExe(), args, {
    cwd,
    stdin: input === undefined ? 'ignore' : 'pipe',
    input,
  })
}
