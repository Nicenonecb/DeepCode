export type AgenticSandboxSubstrateKind =
  | 'local'
  | 'container'
  | 'microvm'
  | 'fullvm'

export type AgenticSandboxStatus =
  | 'prepared'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'

export type AgenticSandboxFallbackPolicy = 'fail' | 'fallback-to-local'

export type AgenticSandboxResourceLimits = {
  timeoutMs?: number
  maxOutputChars?: number
  maxCommands?: number
  cpuCores?: number
  memoryMb?: number
  diskMb?: number
  network?: 'default' | 'disabled' | 'allowlist'
  allowedNetworkHosts?: string[]
}

export type AgenticSandboxPolicyViolation = {
  code:
    | 'max_commands_exceeded'
    | 'local_resource_limit_unsupported'
    | 'network_allowlist_unsupported'
    | 'disk_limit_unsupported'
  message: string
  limit?: string
}

export type AgenticSandboxCacheSpec = {
  image?: string
  cacheKey?: string
  warm?: boolean
  warmCommands?: string[]
}

export type AgenticSandboxCacheState = {
  image?: string
  cacheKey: string
  keySource: 'explicit' | 'workspace'
  warmRequested: boolean
  warmCommands: string[]
}

export type AgenticSandboxWorkspaceSnapshot = {
  id: string
  path: string
  createdAt: string
  cwd: string
  files: Array<{
    path: string
    sizeBytes: number
    mtimeMs: number
    sha256: string
  }>
}

export type AgenticSandboxReplayPlan = {
  scriptPath: string
  manifestPath: string
  commandCount: number
  restoreHint?: string
}

export type AgenticSandboxRecoveryState = {
  snapshot?: AgenticSandboxWorkspaceSnapshot
  replay?: AgenticSandboxReplayPlan
}

export type AgenticSandboxRequest = {
  id: string
  cwd: string
  purpose: string
  substrate?: AgenticSandboxSubstrateKind
  fallbackPolicy?: AgenticSandboxFallbackPolicy
  cache?: AgenticSandboxCacheSpec
  snapshot?: boolean
  resourceLimits?: AgenticSandboxResourceLimits
  traceDir?: string
  metadata?: Record<string, string | number | boolean>
}

export type AgenticSandboxCommand = {
  id?: string
  command: string
  args?: string[]
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  description?: string
}

export type AgenticSandboxCommandResult = {
  commandId: string
  status: AgenticSandboxStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  error?: string
  policyViolation?: AgenticSandboxPolicyViolation
}

export type AgenticSandboxCommandTrace = AgenticSandboxCommandResult & {
  command: string
  args: string[]
  cwd: string
  startedAt: string
  finishedAt: string
  description?: string
  resourceLimits: AgenticSandboxResourceLimits
}

export type AgenticSandboxManifest = {
  version: 1
  sessionId: string
  purpose: string
  substrate: AgenticSandboxSubstrateKind
  requestedSubstrate?: AgenticSandboxSubstrateKind
  fallbackReason?: string
  cwd: string
  traceDir: string
  status: AgenticSandboxStatus
  startedAt: string
  finishedAt?: string
  cache?: AgenticSandboxCacheState
  recovery?: AgenticSandboxRecoveryState
  resourceLimits: AgenticSandboxResourceLimits
  policyViolations: AgenticSandboxPolicyViolation[]
  metadata?: Record<string, string | number | boolean>
  commands: AgenticSandboxCommandTrace[]
  summary: {
    commandCount: number
    succeeded: number
    failed: number
    timedOut: number
  }
}

export type AgenticSandboxTraceRef = {
  sessionId: string
  purpose: string
  status: AgenticSandboxStatus
  substrate: AgenticSandboxSubstrateKind
  requestedSubstrate?: AgenticSandboxSubstrateKind
  fallbackReason?: string
  traceDir: string
  manifestPath: string
  replayScriptPath?: string
  snapshotPath?: string
  commandCount: number
  policyViolationCount: number
}

export type AgenticSandboxTraceBundle = {
  sessionId: string
  traceDir?: string
  traces: AgenticSandboxTraceRef[]
  manifestPaths: string[]
  replayScriptPaths: string[]
  snapshotPaths: string[]
  commandCount: number
  policyViolationCount: number
  fallbackReasons: string[]
}

export type AgenticSandboxPrepareResult = {
  substrate: AgenticSandboxSubstrateKind
  requestedSubstrate?: AgenticSandboxSubstrateKind
  fallbackReason?: string
  cwd: string
  traceDir: string
  cacheSpec?: AgenticSandboxCacheSpec
  cache?: AgenticSandboxCacheState
  recovery?: AgenticSandboxRecoveryState
  resourceLimits: AgenticSandboxResourceLimits
  policyViolations?: AgenticSandboxPolicyViolation[]
}

export type AgenticSandboxSubstrate = {
  kind: AgenticSandboxSubstrateKind
  prepare(request: AgenticSandboxRequest): Promise<AgenticSandboxPrepareResult>
  runCommand(
    command: AgenticSandboxCommand,
    context: AgenticSandboxPrepareResult,
    signal?: AbortSignal,
  ): Promise<AgenticSandboxCommandResult>
  dispose?(context: AgenticSandboxPrepareResult): Promise<void>
}
