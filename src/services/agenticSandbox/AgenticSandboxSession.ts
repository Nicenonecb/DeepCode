import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  collectPolicyViolations,
  policyViolationResult,
} from './CommandPolicy.js'
import {
  createWorkspaceSnapshot,
  resolveAgenticSandboxCacheState,
  writeReplayPlan,
} from './EnvironmentCache.js'
import {
  createDefaultSubstrateRegistry,
  resolveAgenticSandboxSubstrate,
  type AgenticSandboxSubstrateRegistry,
} from './SubstrateRegistry.js'
import type {
  AgenticSandboxCommand,
  AgenticSandboxCommandResult,
  AgenticSandboxCommandTrace,
  AgenticSandboxManifest,
  AgenticSandboxPolicyViolation,
  AgenticSandboxPrepareResult,
  AgenticSandboxRequest,
  AgenticSandboxRecoveryState,
  AgenticSandboxStatus,
  AgenticSandboxSubstrate,
  AgenticSandboxSubstrateKind,
} from './types.js'

export type AgenticSandboxSessionOptions = {
  substrates?: AgenticSandboxSubstrateRegistry
  clock?: () => Date
}

export class AgenticSandboxSession {
  private readonly request: AgenticSandboxRequest
  private readonly substrate: AgenticSandboxSubstrate
  private readonly requestedSubstrate: AgenticSandboxSubstrateKind
  private readonly fallbackReason?: string
  private readonly clock: () => Date
  private context?: AgenticSandboxPrepareResult
  private recovery?: AgenticSandboxRecoveryState
  private readonly policyViolations: AgenticSandboxPolicyViolation[] = []
  private status: AgenticSandboxStatus = 'prepared'
  private readonly startedAt: string
  private finishedAt?: string
  private commandCounter = 0
  private readonly commands: AgenticSandboxCommandTrace[] = []

  constructor(
    request: AgenticSandboxRequest,
    options: AgenticSandboxSessionOptions = {},
  ) {
    this.request = request
    this.clock = options.clock ?? (() => new Date())
    this.startedAt = this.clock().toISOString()
    const resolved = resolveAgenticSandboxSubstrate(request, {
      ...createDefaultSubstrateRegistry(),
      ...options.substrates,
    })
    this.substrate = resolved.substrate
    this.requestedSubstrate = resolved.requestedSubstrate
    this.fallbackReason = resolved.fallbackReason
  }

  async prepare(): Promise<AgenticSandboxPrepareResult> {
    if (this.context) return this.context
    const context = await this.substrate.prepare(this.request)
    const cache = await resolveAgenticSandboxCacheState({
      cwd: context.cwd,
      cache: context.cacheSpec,
    })
    const recovery =
      this.request.snapshot === false
        ? undefined
        : {
            snapshot: await createWorkspaceSnapshot({
              cwd: context.cwd,
              traceDir: context.traceDir,
              sessionId: this.request.id,
              now: this.clock(),
            }),
          }
    this.recovery = recovery
    this.context = {
      ...context,
      cache,
      ...(recovery ? { recovery } : {}),
      requestedSubstrate: context.requestedSubstrate ?? this.requestedSubstrate,
      fallbackReason: context.fallbackReason ?? this.fallbackReason,
    }
    return this.context
  }

  async runCommand(
    command: AgenticSandboxCommand,
    signal?: AbortSignal,
  ): Promise<AgenticSandboxCommandResult> {
    const context = await this.prepare()
    const commandId =
      command.id ?? `${this.request.id}-cmd-${++this.commandCounter}`
    const cwd = command.cwd ?? context.cwd
    const args = command.args ?? []
    const startedAt = this.clock().toISOString()
    this.status = 'running'

    const violations = collectPolicyViolations({
      context,
      currentCommandCount: this.commands.length,
    })
    this.policyViolations.push(...violations)
    const result =
      violations.length > 0
        ? policyViolationResult({ commandId, violation: violations[0]! })
        : await this.substrate.runCommand(
            { ...command, id: commandId, args, cwd },
            context,
            signal,
          )
    const finishedAt = this.clock().toISOString()
    const normalizedResult = {
      ...result,
      commandId,
    }
    this.commands.push({
      ...normalizedResult,
      command: command.command,
      args,
      cwd,
      startedAt,
      finishedAt,
      ...(command.description ? { description: command.description } : {}),
      resourceLimits: context.resourceLimits,
    })
    this.status = statusAfterCommand(normalizedResult.status)
    await this.writeManifest()
    return normalizedResult
  }

  async close(status: AgenticSandboxStatus = this.status): Promise<void> {
    this.status = status
    this.finishedAt = this.clock().toISOString()
    if (this.context && this.substrate.dispose) {
      await this.substrate.dispose(this.context)
    }
    if (this.context) {
      const manifestPath = this.manifestPath(this.context.traceDir)
      const replay = await writeReplayPlan({
        traceDir: this.context.traceDir,
        sessionId: this.request.id,
        manifestPath,
        commands: this.commands,
      })
      this.recovery = {
        ...(this.recovery ?? {}),
        replay,
      }
      this.context = {
        ...this.context,
        recovery: this.recovery,
        policyViolations: this.policyViolations,
      }
    }
    await this.writeManifest()
  }

  manifest(): AgenticSandboxManifest {
    const context = this.context
    const traceDir =
      context?.traceDir ?? this.request.traceDir ?? this.request.cwd
    const resourceLimits = context?.resourceLimits ?? {}
    const summary = summarizeCommands(this.commands)
    return {
      version: 1,
      sessionId: this.request.id,
      purpose: this.request.purpose,
      substrate: this.substrate.kind,
      requestedSubstrate:
        context?.requestedSubstrate ?? this.requestedSubstrate,
      cwd: context?.cwd ?? this.request.cwd,
      traceDir,
      status: this.status,
      startedAt: this.startedAt,
      ...(this.finishedAt ? { finishedAt: this.finishedAt } : {}),
      ...(context?.cache ? { cache: context.cache } : {}),
      ...(context?.recovery ? { recovery: context.recovery } : {}),
      ...(context?.fallbackReason
        ? { fallbackReason: context.fallbackReason }
        : {}),
      resourceLimits,
      policyViolations: this.policyViolations,
      ...(this.request.metadata ? { metadata: this.request.metadata } : {}),
      commands: this.commands,
      summary,
    }
  }

  async writeManifest(): Promise<string> {
    const manifest = this.manifest()
    await mkdir(manifest.traceDir, { recursive: true })
    const path = this.manifestPath(manifest.traceDir)
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
    return path
  }

  private manifestPath(traceDir: string): string {
    return join(traceDir, `${this.request.id}.sandbox.json`)
  }
}

function statusAfterCommand(
  status: AgenticSandboxCommandResult['status'],
): AgenticSandboxStatus {
  if (status === 'timed_out') return 'timed_out'
  if (status === 'completed') return 'completed'
  return 'failed'
}

function summarizeCommands(
  commands: AgenticSandboxCommandTrace[],
): AgenticSandboxManifest['summary'] {
  return {
    commandCount: commands.length,
    succeeded: commands.filter(command => command.status === 'completed')
      .length,
    failed: commands.filter(command => command.status === 'failed').length,
    timedOut: commands.filter(command => command.status === 'timed_out').length,
  }
}
