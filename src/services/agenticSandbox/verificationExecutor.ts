import { join } from 'node:path'
import type {
  VerificationCommand,
  VerificationCommandExecutionResult,
  VerificationCommandExecutor,
} from '../verification/index.js'
import { AgenticSandboxSession } from './AgenticSandboxSession.js'
import type {
  AgenticSandboxManifest,
  AgenticSandboxRequest,
  AgenticSandboxTraceRef,
  AgenticSandboxSubstrateKind,
} from './types.js'

export type AgenticSandboxVerificationExecutorOptions = {
  sessionId: string
  purpose?: string
  substrate?: AgenticSandboxSubstrateKind
  fallbackPolicy?: AgenticSandboxRequest['fallbackPolicy']
  traceDir?: string
  metadata?: Record<string, string | number | boolean>
  onTrace?: (trace: AgenticSandboxTraceRef) => void
}

export function createAgenticSandboxVerificationExecutor(
  options: AgenticSandboxVerificationExecutorOptions,
): VerificationCommandExecutor {
  return async (
    command: VerificationCommand,
  ): Promise<VerificationCommandExecutionResult> => {
    const session = await createSessionForCommand(options, command)
    const result = await session.runCommand({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      description: command.name,
    })
    await session.close(result.status)
    options.onTrace?.(traceRefFromManifest(session.manifest()))

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.status === 'timed_out' ? { timedOut: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    }
  }
}

export function traceRefFromManifest(
  manifest: AgenticSandboxManifest,
): AgenticSandboxTraceRef {
  return {
    sessionId: manifest.sessionId,
    purpose: manifest.purpose,
    status: manifest.status,
    substrate: manifest.substrate,
    ...(manifest.requestedSubstrate
      ? { requestedSubstrate: manifest.requestedSubstrate }
      : {}),
    ...(manifest.fallbackReason
      ? { fallbackReason: manifest.fallbackReason }
      : {}),
    traceDir: manifest.traceDir,
    manifestPath:
      manifest.recovery?.replay?.manifestPath ??
      join(manifest.traceDir, `${manifest.sessionId}.sandbox.json`),
    ...(manifest.recovery?.replay?.scriptPath
      ? { replayScriptPath: manifest.recovery.replay.scriptPath }
      : {}),
    ...(manifest.recovery?.snapshot?.path
      ? { snapshotPath: manifest.recovery.snapshot.path }
      : {}),
    commandCount: manifest.summary.commandCount,
    policyViolationCount: manifest.policyViolations.length,
  }
}

async function createSessionForCommand(
  options: AgenticSandboxVerificationExecutorOptions,
  command: VerificationCommand,
): Promise<AgenticSandboxSession> {
  const request: AgenticSandboxRequest = {
    id: `${options.sessionId}-${sanitizeId(command.name)}`,
    cwd: command.cwd,
    purpose: options.purpose ?? 'verification',
    substrate: options.substrate ?? 'local',
    fallbackPolicy: options.fallbackPolicy,
    traceDir:
      options.traceDir ?? join(command.cwd, '.deepcode', 'sandbox-traces'),
    resourceLimits: {
      timeoutMs: command.timeoutMs,
    },
    metadata: {
      commandKind: command.kind,
      commandName: command.name,
      ...(options.metadata ?? {}),
    },
  }
  const session = new AgenticSandboxSession(request)
  await session.prepare()
  return session
}

function sanitizeId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'command'
  )
}
