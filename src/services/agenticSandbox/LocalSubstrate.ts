import type {
  AgenticSandboxCommand,
  AgenticSandboxCommandResult,
  AgenticSandboxPrepareResult,
  AgenticSandboxRequest,
  AgenticSandboxResourceLimits,
  AgenticSandboxSubstrate,
} from './types.js'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_MAX_OUTPUT_CHARS = 12_000

export class LocalAgenticSandboxSubstrate implements AgenticSandboxSubstrate {
  readonly kind = 'local'

  async prepare(
    request: AgenticSandboxRequest,
  ): Promise<AgenticSandboxPrepareResult> {
    return {
      substrate: 'local',
      cwd: request.cwd,
      traceDir: request.traceDir ?? request.cwd,
      ...(request.cache ? { cacheSpec: request.cache } : {}),
      resourceLimits: normalizeResourceLimits(request.resourceLimits),
    }
  }

  async runCommand(
    command: AgenticSandboxCommand,
    context: AgenticSandboxPrepareResult,
    signal?: AbortSignal,
  ): Promise<AgenticSandboxCommandResult> {
    const startedAt = Date.now()
    const timeoutMs =
      normalizePositiveNumber(command.timeoutMs) ??
      context.resourceLimits.timeoutMs ??
      DEFAULT_TIMEOUT_MS
    const maxOutputChars =
      context.resourceLimits.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
    const proc = Bun.spawn([command.command, ...(command.args ?? [])], {
      cwd: command.cwd ?? context.cwd,
      env: {
        ...process.env,
        ...(command.env ?? {}),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)

    const abort = () => {
      proc.kill()
    }
    signal?.addEventListener('abort', abort, { once: true })

    try {
      const [exitCode, stdoutRaw, stderrRaw] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const stdout = truncateOutput(stdoutRaw, maxOutputChars)
      const stderr = truncateOutput(stderrRaw, maxOutputChars)
      return {
        commandId: command.id ?? '',
        status: timedOut
          ? 'timed_out'
          : exitCode === 0
            ? 'completed'
            : 'failed',
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      }
    } catch (error) {
      const stdout = truncateOutput('', maxOutputChars)
      const stderr = truncateOutput('', maxOutputChars)
      return {
        commandId: command.id ?? '',
        status: timedOut ? 'timed_out' : 'failed',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

export function normalizeResourceLimits(
  limits?: AgenticSandboxResourceLimits,
): AgenticSandboxResourceLimits {
  return {
    timeoutMs: normalizePositiveNumber(limits?.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    maxOutputChars:
      normalizePositiveNumber(limits?.maxOutputChars) ??
      DEFAULT_MAX_OUTPUT_CHARS,
    ...(normalizePositiveNumber(limits?.maxCommands)
      ? { maxCommands: normalizePositiveNumber(limits?.maxCommands) }
      : {}),
    ...(normalizePositiveNumber(limits?.cpuCores)
      ? { cpuCores: normalizePositiveNumber(limits?.cpuCores) }
      : {}),
    ...(normalizePositiveNumber(limits?.memoryMb)
      ? { memoryMb: normalizePositiveNumber(limits?.memoryMb) }
      : {}),
    ...(normalizePositiveNumber(limits?.diskMb)
      ? { diskMb: normalizePositiveNumber(limits?.diskMb) }
      : {}),
    network: limits?.network ?? 'default',
  }
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

function truncateOutput(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }

  const marker = '\n...[agentic sandbox log truncated]...\n'
  const headLength = Math.max(0, Math.floor((maxChars - marker.length) / 2))
  const tailLength = Math.max(0, maxChars - marker.length - headLength)
  return {
    text: `${text.slice(0, headLength)}${marker}${text.slice(text.length - tailLength)}`,
    truncated: true,
  }
}
