import type { ToolUseContext } from '../../Tool.js'
import type { ToolCallRepairIssue } from '../toolRepair/types.js'
import {
  PatchSearchRunner,
  type PatchSearchStatusSink,
} from './PatchSearchRunner.js'
import type {
  PatchSearchFooterStatus,
  PatchSearchMode,
  PatchSearchRequest,
  PatchSearchResult,
} from './types.js'

export type PatchSearchTriggerSource = 'query' | 'agent'

export type PatchSearchHighRiskContext = {
  source: PatchSearchTriggerSource
  prompt: string
  toolUseContext: Pick<ToolUseContext, 'setAppState' | 'setAppStateForTasks'>
  repairIssues?: ToolCallRepairIssue[]
  runner?: Pick<PatchSearchRunner, 'run'>
  enabled?: boolean
  maxCandidates?: number
  mode?: PatchSearchMode
}

export type PatchSearchTriggerReason =
  | 'explicit_env'
  | 'multiple_retryable_failures'
  | 'high_risk_tool_failure'
  | 'verification_failure'
  | 'complex_repair_prompt'

export type PatchSearchTriggerDecision = {
  shouldTrigger: boolean
  reasons: PatchSearchTriggerReason[]
}

export function createAppStatePatchSearchStatusSink(
  toolUseContext: Pick<ToolUseContext, 'setAppState' | 'setAppStateForTasks'>,
): PatchSearchStatusSink {
  const setState =
    toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
  return (patchSearchStatus: PatchSearchFooterStatus) => {
    setState(prev => ({
      ...prev,
      patchSearchStatus,
    }))
  }
}

export function shouldTriggerPatchSearchForHighRiskContext({
  enabled,
  prompt = '',
  repairIssues = [],
}: {
  enabled?: boolean
  prompt?: string
  repairIssues?: ToolCallRepairIssue[]
}): boolean {
  return evaluatePatchSearchTrigger({
    enabled,
    prompt,
    repairIssues,
  }).shouldTrigger
}

export function evaluatePatchSearchTrigger({
  enabled,
  prompt = '',
  repairIssues = [],
}: {
  enabled?: boolean
  prompt?: string
  repairIssues?: ToolCallRepairIssue[]
}): PatchSearchTriggerDecision {
  if (enabled === false) return { shouldTrigger: false, reasons: [] }

  const retryableIssues = repairIssues.filter(issue => issue.retryable)
  const reasons: PatchSearchTriggerReason[] = []

  if (process.env.DEEPCODE_PATCH_SEARCH_AUTOTRIGGER === '1') {
    reasons.push('explicit_env')
  }
  if (retryableIssues.length >= 2) {
    reasons.push('multiple_retryable_failures')
  }
  if (retryableIssues.some(isHighRiskRepairIssue)) {
    reasons.push('high_risk_tool_failure')
  }
  if (retryableIssues.some(isVerificationRepairIssue)) {
    reasons.push('verification_failure')
  }
  if (isComplexRepairPrompt(prompt)) {
    reasons.push('complex_repair_prompt')
  }

  return {
    shouldTrigger:
      retryableIssues.length > 0 && (enabled === true || reasons.length > 0),
    reasons,
  }
}

export async function runPatchSearchForHighRiskContext({
  source,
  prompt,
  toolUseContext,
  repairIssues = [],
  runner,
  enabled,
  maxCandidates = 2,
  mode,
}: PatchSearchHighRiskContext): Promise<PatchSearchResult | undefined> {
  const trigger = evaluatePatchSearchTrigger({ enabled, prompt, repairIssues })
  if (!trigger.shouldTrigger) {
    return undefined
  }

  const statusSink = createAppStatePatchSearchStatusSink(toolUseContext)
  const request = createHighRiskPatchSearchRequest({
    source,
    prompt,
    repairIssues,
    maxCandidates,
    mode,
    triggerReasons: trigger.reasons,
  })
  const activeRunner =
    runner ??
    new PatchSearchRunner({
      onStatus: statusSink,
      maxCandidates,
    })

  return activeRunner.run(request)
}

export function createHighRiskPatchSearchRequest({
  source,
  prompt,
  repairIssues,
  maxCandidates,
  mode,
  triggerReasons,
}: {
  source: PatchSearchTriggerSource
  prompt: string
  repairIssues: ToolCallRepairIssue[]
  maxCandidates: number
  mode?: PatchSearchMode
  triggerReasons?: PatchSearchTriggerReason[]
}): PatchSearchRequest {
  return {
    id: `patch-search-${source}-${Date.now()}`,
    prompt: buildPatchSearchPrompt(prompt, repairIssues, triggerReasons ?? []),
    maxCandidates,
    mode: mode ?? patchSearchModeFromEnv(),
    cleanupWorktrees: false,
    executorCommand: process.env.DEEPCODE_PATCH_SEARCH_EXECUTOR_COMMAND,
    patchApplication: { mode: 'recommend' },
  }
}

function patchSearchModeFromEnv(): PatchSearchMode {
  return process.env.DEEPCODE_PATCH_SEARCH_DRY_RUN === '1'
    ? 'dry_run'
    : 'execute'
}

function buildPatchSearchPrompt(
  prompt: string,
  repairIssues: ToolCallRepairIssue[],
  triggerReasons: PatchSearchTriggerReason[],
): string {
  const issueLines = repairIssues.map(
    issue =>
      `- ${issue.toolName}: ${issue.message}${issue.repairHint ? ` (${issue.repairHint})` : ''}`,
  )
  const triggerLines = triggerReasons.map(reason => `- ${reason}`)
  return [
    prompt,
    '',
    'High-risk repair context:',
    ...(triggerLines.length > 0 ? ['Trigger reasons:', ...triggerLines] : []),
    ...issueLines,
    '',
    'Search for candidate patches that fix only the failed path.',
  ].join('\n')
}

function isHighRiskRepairIssue(issue: ToolCallRepairIssue): boolean {
  return ['Bash', 'Agent', 'Task', 'Edit', 'MultiEdit', 'Write'].includes(
    issue.toolName,
  )
}

function isVerificationRepairIssue(issue: ToolCallRepairIssue): boolean {
  const haystack = `${issue.toolName} ${issue.message} ${issue.repairHint}`
  return /verify|verification|test|typecheck|tsc|lint|build|bun test|pytest|cargo test|go test|npm test|测试|验证|构建/i.test(
    haystack,
  )
}

function isComplexRepairPrompt(prompt: string): boolean {
  return /complex|difficult|hard|high[- ]?risk|bug ?fix|debug|repair|refactor|migration|cross[- ]?cutting|multi[- ]?file|architecture|复杂|疑难|高风险|修复|调试|重构|迁移|多文件|架构/i.test(
    prompt,
  )
}
