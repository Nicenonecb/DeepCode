import type {
  AgenticSandboxCommandResult,
  AgenticSandboxPolicyViolation,
  AgenticSandboxPrepareResult,
} from './types.js'

export function collectPolicyViolations({
  context,
  currentCommandCount,
}: {
  context: AgenticSandboxPrepareResult
  currentCommandCount: number
}): AgenticSandboxPolicyViolation[] {
  const violations: AgenticSandboxPolicyViolation[] = []
  const limits = context.resourceLimits

  if (
    limits.maxCommands !== undefined &&
    currentCommandCount >= limits.maxCommands
  ) {
    violations.push({
      code: 'max_commands_exceeded',
      limit: 'maxCommands',
      message: `Agentic sandbox command limit exceeded (${currentCommandCount}/${limits.maxCommands}).`,
    })
  }

  if (context.substrate === 'local') {
    if (limits.cpuCores !== undefined || limits.memoryMb !== undefined) {
      violations.push({
        code: 'local_resource_limit_unsupported',
        limit: 'cpuCores/memoryMb',
        message:
          'Local agentic sandbox cannot enforce CPU or memory limits; use container, microvm, or fullvm substrate.',
      })
    }
    if (limits.diskMb !== undefined) {
      violations.push({
        code: 'disk_limit_unsupported',
        limit: 'diskMb',
        message:
          'Local agentic sandbox cannot enforce disk limits; use a substrate with filesystem quotas.',
      })
    }
    if (
      limits.network === 'disabled' ||
      limits.network === 'allowlist' ||
      (limits.allowedNetworkHosts?.length ?? 0) > 0
    ) {
      violations.push({
        code: 'network_allowlist_unsupported',
        limit: 'network',
        message:
          'Local agentic sandbox cannot enforce network restrictions; use container, microvm, or fullvm substrate.',
      })
    }
  }

  if (
    context.substrate === 'container' &&
    limits.network === 'allowlist' &&
    (limits.allowedNetworkHosts?.length ?? 0) === 0
  ) {
    violations.push({
      code: 'network_allowlist_unsupported',
      limit: 'allowedNetworkHosts',
      message:
        'Container network allowlist requires at least one allowed host or network=disabled.',
    })
  }

  return violations
}

export function policyViolationResult({
  commandId,
  violation,
}: {
  commandId: string
  violation: AgenticSandboxPolicyViolation
}): AgenticSandboxCommandResult {
  return {
    commandId,
    status: 'failed',
    exitCode: null,
    durationMs: 0,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    error: violation.message,
    policyViolation: violation,
  }
}
