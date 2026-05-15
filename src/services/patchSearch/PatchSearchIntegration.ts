import type { ToolUseContext } from '../../Tool.js'
import type { ToolCallRepairIssue } from '../toolRepair/types.js'
import {
  PatchSearchRunner,
  type PatchSearchStatusSink,
} from './PatchSearchRunner.js'
import type {
  PatchSearchFooterStatus,
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
  enabled = process.env.DEEPCODE_PATCH_SEARCH_AUTOTRIGGER === '1',
  repairIssues = [],
}: Pick<PatchSearchHighRiskContext, 'enabled' | 'repairIssues'>): boolean {
  if (!enabled) return false
  return repairIssues.some(issue => issue.retryable)
}

export async function runPatchSearchForHighRiskContext({
  source,
  prompt,
  toolUseContext,
  repairIssues = [],
  runner,
  enabled,
  maxCandidates = 2,
}: PatchSearchHighRiskContext): Promise<PatchSearchResult | undefined> {
  if (!shouldTriggerPatchSearchForHighRiskContext({ enabled, repairIssues })) {
    return undefined
  }

  const statusSink = createAppStatePatchSearchStatusSink(toolUseContext)
  const request = createHighRiskPatchSearchRequest({
    source,
    prompt,
    repairIssues,
    maxCandidates,
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
}: {
  source: PatchSearchTriggerSource
  prompt: string
  repairIssues: ToolCallRepairIssue[]
  maxCandidates: number
}): PatchSearchRequest {
  return {
    id: `patch-search-${source}-${Date.now()}`,
    prompt: buildPatchSearchPrompt(prompt, repairIssues),
    maxCandidates,
    mode: 'dry_run',
    cleanupWorktrees: false,
    patchApplication: { mode: 'recommend' },
  }
}

function buildPatchSearchPrompt(
  prompt: string,
  repairIssues: ToolCallRepairIssue[],
): string {
  const issueLines = repairIssues.map(
    issue =>
      `- ${issue.toolName}: ${issue.message}${issue.repairHint ? ` (${issue.repairHint})` : ''}`,
  )
  return [
    prompt,
    '',
    'High-risk repair context:',
    ...issueLines,
    '',
    'Search for candidate patches that fix only the failed path.',
  ].join('\n')
}
