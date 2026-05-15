import type {
  AgenticSandboxCommand,
  AgenticSandboxCommandResult,
  AgenticSandboxPrepareResult,
  AgenticSandboxRequest,
  AgenticSandboxSubstrate,
  AgenticSandboxSubstrateKind,
} from './types.js'

export class UnavailableAgenticSandboxSubstrate
  implements AgenticSandboxSubstrate
{
  constructor(
    readonly kind: AgenticSandboxSubstrateKind,
    readonly reason: string,
  ) {}

  async prepare(
    request: AgenticSandboxRequest,
  ): Promise<AgenticSandboxPrepareResult> {
    if (request.fallbackPolicy === 'fallback-to-local') {
      return {
        substrate: 'local',
        requestedSubstrate: this.kind,
        fallbackReason: this.reason,
        cwd: request.cwd,
        traceDir: request.traceDir ?? request.cwd,
        ...(request.cache ? { cacheSpec: request.cache } : {}),
        resourceLimits: request.resourceLimits ?? {},
      }
    }

    throw new Error(this.reason)
  }

  async runCommand(
    command: AgenticSandboxCommand,
  ): Promise<AgenticSandboxCommandResult> {
    return {
      commandId: command.id ?? '',
      status: 'failed',
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      error: this.reason,
    }
  }
}
