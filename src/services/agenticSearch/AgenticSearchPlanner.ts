import type {
  AgenticSearchBudget,
  AgenticSearchEffort,
  AgenticSearchEvidenceRequirement,
  AgenticSearchIntent,
  AgenticSearchLivecrawlMode,
  AgenticSearchPlan,
  AgenticSearchPlannerInput,
  AgenticSearchPlanStep,
  AgenticSearchPlanSummary,
  AgenticSearchSearchType,
  AgenticSearchSourceKind,
} from './types.js'

const EFFORT_BUDGETS: Record<AgenticSearchEffort, AgenticSearchBudget> = {
  fast: {
    maxRounds: 1,
    maxSearches: 1,
    maxFetches: 2,
    maxParallelFetches: 2,
    maxEvidenceChars: 12_000,
    maxContextChars: 16_000,
  },
  balanced: {
    maxRounds: 2,
    maxSearches: 3,
    maxFetches: 6,
    maxParallelFetches: 3,
    maxEvidenceChars: 32_000,
    maxContextChars: 48_000,
  },
  deep: {
    maxRounds: 3,
    maxSearches: 6,
    maxFetches: 12,
    maxParallelFetches: 4,
    maxEvidenceChars: 80_000,
    maxContextChars: 120_000,
  },
}

const RECENCY_PATTERN =
  /\b(latest|current|today|recent|news|pricing|version|changelog|release|now|202[6-9])\b|最新|今天|当前|近期|新闻|版本|发布|价格/
const DOCS_PATTERN =
  /\b(api|docs|documentation|official|sdk|library|framework|spec|standard|provider)\b|文档|官方|规范|接口|供应商/
const CROSS_CHECK_PATTERN =
  /\b(compare|verify|cross[- ]?check|citation|source|evidence|fact|benchmark|a\/b)\b|对比|验证|引用|证据|事实|交叉|基准/
const TOOL_PATTERN =
  /\b(mcp|slack|jira|github|confluence|notion|drive|private|internal|tool)\b|私有|内部|工具/
const LOCAL_PATTERN =
  /\b(repo|codebase|implementation|file|local|test|fixture)\b|仓库|代码|实现|文件|测试|夹具/
const BASH_PATTERN =
  /\b(bash|python|script|command|terminal|shell|benchmark|test)\b|脚本|命令|终端|测试|基准/

export class AgenticSearchPlanner {
  plan(input: AgenticSearchPlannerInput): AgenticSearchPlan {
    const task = normalizeTask(input.task)
    const intent = resolveIntent(task)
    const effort = input.effort ?? resolveDefaultEffort(task, intent)
    const budget = EFFORT_BUDGETS[effort]
    const evidenceRequirements = buildEvidenceRequirements(task, intent)
    const mustCrossCheck =
      evidenceRequirements.includes('cross_check') || effort === 'deep'

    return {
      id: `agentic-search-${stableHash(task).toString(36)}`,
      task,
      effort,
      intent,
      budget,
      evidenceRequirements,
      steps: buildPlanSteps({
        input,
        task,
        intent,
        effort,
        budget,
        evidenceRequirements,
        mustCrossCheck,
      }),
      mustCrossCheck,
      createdAt: input.now ?? Date.now(),
    }
  }
}

export function createAgenticSearchPlan(
  input: AgenticSearchPlannerInput,
): AgenticSearchPlan {
  return new AgenticSearchPlanner().plan(input)
}

export function summarizeAgenticSearchPlan(
  plan: AgenticSearchPlan,
): AgenticSearchPlanSummary {
  return {
    planId: plan.id,
    intent: plan.intent,
    effort: plan.effort,
    stepCount: plan.steps.length,
    webSearchCount: countSteps(plan.steps, 'web_search'),
    webFetchCount: countSteps(plan.steps, 'web_fetch'),
    mcpSearchCount: countSteps(plan.steps, 'mcp_search'),
    localSearchCount: countSteps(plan.steps, 'local_search'),
    bashSearchCount: countSteps(plan.steps, 'bash_search'),
    maxRound: Math.max(0, ...plan.steps.map(step => step.round)),
    evidenceRequirements: plan.evidenceRequirements,
    mustCrossCheck: plan.mustCrossCheck,
    maxEvidenceChars: plan.budget.maxEvidenceChars,
    maxContextChars: plan.budget.maxContextChars,
  }
}

export function shouldUseAgenticSearch(task: string): boolean {
  const normalized = normalizeTask(task)
  return (
    RECENCY_PATTERN.test(normalized) ||
    DOCS_PATTERN.test(normalized) ||
    CROSS_CHECK_PATTERN.test(normalized) ||
    TOOL_PATTERN.test(normalized)
  )
}

function buildPlanSteps({
  input,
  task,
  intent,
  effort,
  budget,
  evidenceRequirements,
  mustCrossCheck,
}: {
  input: AgenticSearchPlannerInput
  task: string
  intent: AgenticSearchIntent
  effort: AgenticSearchEffort
  budget: AgenticSearchBudget
  evidenceRequirements: AgenticSearchEvidenceRequirement[]
  mustCrossCheck: boolean
}): AgenticSearchPlanStep[] {
  const steps: AgenticSearchPlanStep[] = []
  const searchType = resolveSearchType(effort)
  const livecrawl = resolveLivecrawlMode(effort, evidenceRequirements)
  const contextMaxCharacters = Math.floor(
    budget.maxContextChars / Math.max(1, budget.maxSearches),
  )

  if (allowsSource(input, 'local_search') && LOCAL_PATTERN.test(task)) {
    steps.push(
      createStep({
        index: steps.length,
        round: 1,
        source: 'local_search',
        query: task,
        purpose:
          'Find local implementation context before spending external search budget.',
        priority: 95,
      }),
    )
  }

  if (allowsSource(input, 'mcp_search') && intent === 'tool_or_mcp_lookup') {
    steps.push(
      createStep({
        index: steps.length,
        round: 1,
        source: 'mcp_search',
        query: task,
        purpose:
          'Check authenticated or private knowledge sources before public web fetches.',
        priority: 100,
      }),
    )
  }

  if (
    allowsSource(input, 'bash_search') &&
    BASH_PATTERN.test(task) &&
    budget.maxSearches > countSearchSteps(steps)
  ) {
    steps.push(
      createStep({
        index: steps.length,
        round: 1,
        source: 'bash_search',
        query: task,
        purpose:
          'Collect command, script, test, or Python/Bash evidence from the local execution environment.',
        priority: 92,
        contextMaxCharacters,
      }),
    )
  }

  if (allowsSource(input, 'web_search')) {
    steps.push(
      createStep({
        index: steps.length,
        round: 1,
        source: 'web_search',
        query: task,
        purpose: 'Find candidate sources and establish the search frontier.',
        priority: 90,
        maxResults: resolveNumResults(effort),
        allowedDomains: input.allowedDomains,
        blockedDomains: input.blockedDomains,
        searchType,
        livecrawl,
        contextMaxCharacters,
      }),
    )
  }

  if (
    allowsSource(input, 'web_search') &&
    evidenceRequirements.includes('primary_source') &&
    budget.maxSearches > countSearchSteps(steps)
  ) {
    steps.push(
      createStep({
        index: steps.length,
        round: Math.min(2, budget.maxRounds),
        source: 'web_search',
        query: `${task} official documentation primary source`,
        purpose:
          'Prioritize primary provider documentation or canonical specs.',
        priority: 85,
        maxResults: resolveNumResults(effort),
        allowedDomains: input.allowedDomains,
        blockedDomains: input.blockedDomains,
        searchType,
        livecrawl,
        contextMaxCharacters,
      }),
    )
  }

  if (
    allowsSource(input, 'web_search') &&
    mustCrossCheck &&
    budget.maxSearches > countSearchSteps(steps)
  ) {
    steps.push(
      createStep({
        index: steps.length,
        round: Math.min(2, budget.maxRounds),
        source: 'web_search',
        query: `${task} independent verification comparison`,
        purpose:
          'Find independent sources that can confirm, contradict, or qualify the candidate answer.',
        priority: 80,
        maxResults: resolveNumResults(effort),
        allowedDomains: input.allowedDomains,
        blockedDomains: input.blockedDomains,
        searchType,
        livecrawl,
        contextMaxCharacters,
      }),
    )
  }

  if (allowsSource(input, 'web_fetch') && budget.maxFetches > 0) {
    steps.push(
      createStep({
        index: steps.length,
        round: Math.min(2, budget.maxRounds),
        source: 'web_fetch',
        query: `Fetch and extract the top ranked sources for: ${task}`,
        purpose:
          'Fetch top sources, extract claims, dates, limitations, and citation-ready passages.',
        priority: 75,
        fetchLimit: Math.min(budget.maxFetches, budget.maxParallelFetches),
        contextMaxCharacters: Math.floor(
          budget.maxEvidenceChars / Math.max(1, budget.maxFetches),
        ),
      }),
    )
  }

  if (
    allowsSource(input, 'web_fetch') &&
    mustCrossCheck &&
    budget.maxRounds >= 3 &&
    budget.maxFetches > countSteps(steps, 'web_fetch')
  ) {
    steps.push(
      createStep({
        index: steps.length,
        round: 3,
        source: 'web_fetch',
        query: `Fetch cross-check sources and conflicting evidence for: ${task}`,
        purpose:
          'Fetch independent or dissenting evidence before final synthesis.',
        priority: 70,
        fetchLimit: Math.min(
          budget.maxFetches - countSteps(steps, 'web_fetch'),
          budget.maxParallelFetches,
        ),
        contextMaxCharacters: Math.floor(
          budget.maxEvidenceChars / Math.max(1, budget.maxFetches),
        ),
      }),
    )
  }

  return steps.filter(step => step.round <= budget.maxRounds)
}

function createStep(
  step: Omit<AgenticSearchPlanStep, 'id'> & { index: number },
): AgenticSearchPlanStep {
  const { index, ...rest } = step
  return {
    id: `search-step-${String(index + 1).padStart(2, '0')}`,
    ...rest,
  }
}

function normalizeTask(task: string): string {
  const normalized = task.replace(/\s+/g, ' ').trim()
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized
}

function resolveIntent(task: string): AgenticSearchIntent {
  if (TOOL_PATTERN.test(task)) {
    return 'tool_or_mcp_lookup'
  }
  if (CROSS_CHECK_PATTERN.test(task)) {
    return 'cross_source_fact_check'
  }
  if (DOCS_PATTERN.test(task)) {
    return 'external_docs'
  }
  if (RECENCY_PATTERN.test(task)) {
    return 'current_info'
  }
  if (LOCAL_PATTERN.test(task)) {
    return 'local_context_gap'
  }
  return 'unknown'
}

function resolveDefaultEffort(
  task: string,
  intent: AgenticSearchIntent,
): AgenticSearchEffort {
  if (
    intent === 'cross_source_fact_check' ||
    /\b(deep|comprehensive|thorough|benchmark|multi[- ]?round)\b|彻底|全面|多轮|基准/.test(
      task,
    )
  ) {
    return 'deep'
  }
  if (
    intent === 'unknown' ||
    /\b(quick|brief|simple|fast)\b|快速|简单/.test(task)
  ) {
    return 'fast'
  }
  return 'balanced'
}

function buildEvidenceRequirements(
  task: string,
  intent: AgenticSearchIntent,
): AgenticSearchEvidenceRequirement[] {
  const requirements: AgenticSearchEvidenceRequirement[] = ['citation']

  if (intent === 'external_docs' || DOCS_PATTERN.test(task)) {
    requirements.push('primary_source')
  }
  if (intent === 'cross_source_fact_check' || CROSS_CHECK_PATTERN.test(task)) {
    requirements.push('cross_check')
  }
  if (intent === 'current_info' || RECENCY_PATTERN.test(task)) {
    requirements.push('recency')
  }
  if (
    intent === 'local_context_gap' ||
    intent === 'tool_or_mcp_lookup' ||
    LOCAL_PATTERN.test(task)
  ) {
    requirements.push('implementation_context')
  }

  return [...new Set(requirements)]
}

function resolveSearchType(
  effort: AgenticSearchEffort,
): AgenticSearchSearchType {
  if (effort === 'fast') {
    return 'fast'
  }
  if (effort === 'deep') {
    return 'deep'
  }
  return 'auto'
}

function resolveLivecrawlMode(
  effort: AgenticSearchEffort,
  evidenceRequirements: AgenticSearchEvidenceRequirement[],
): AgenticSearchLivecrawlMode {
  if (effort === 'deep' || evidenceRequirements.includes('recency')) {
    return 'preferred'
  }
  return 'fallback'
}

function resolveNumResults(effort: AgenticSearchEffort): number {
  if (effort === 'fast') {
    return 5
  }
  if (effort === 'deep') {
    return 12
  }
  return 8
}

function allowsSource(
  input: AgenticSearchPlannerInput,
  source: AgenticSearchSourceKind,
): boolean {
  if (!input.preferredSources?.length) {
    return true
  }
  return input.preferredSources.includes(source)
}

function countSteps(
  steps: AgenticSearchPlanStep[],
  source: AgenticSearchSourceKind,
): number {
  return steps.filter(step => step.source === source).length
}

function countSearchSteps(steps: AgenticSearchPlanStep[]): number {
  return steps.filter(step =>
    ['web_search', 'mcp_search', 'local_search', 'bash_search'].includes(
      step.source,
    ),
  ).length
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}
