import { join } from 'node:path'
import type {
  VerificationCommand,
  VerificationCommandExecutionResult,
  VerificationCommandExecutor,
} from '../verification/index.js'
import { AgenticSandboxSession } from './AgenticSandboxSession.js'
import type {
  AgenticSandboxRequest,
  AgenticSandboxSubstrateKind,
} from './types.js'

export type AgenticSandboxVerificationExecutorOptions = {
  sessionId: string
  purpose?: string
  substrate?: AgenticSandboxSubstrateKind
  fallbackPolicy?: AgenticSandboxRequest['fallbackPolicy']
  traceDir?: string
  metadata?: Record<string, string | number | boolean>
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

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.status === 'timed_out' ? { timedOut: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    }
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
