export type AgenticSearchEffort = 'fast' | 'balanced' | 'deep'

export type AgenticSearchIntent =
  | 'current_info'
  | 'external_docs'
  | 'cross_source_fact_check'
  | 'tool_or_mcp_lookup'
  | 'local_context_gap'
  | 'unknown'

export type AgenticSearchSourceKind =
  | 'web_search'
  | 'web_fetch'
  | 'mcp_search'
  | 'local_search'
  | 'bash_search'

export type AgenticSearchEvidenceRequirement =
  | 'citation'
  | 'primary_source'
  | 'cross_check'
  | 'recency'
  | 'implementation_context'

export type AgenticSearchSearchType = 'auto' | 'fast' | 'deep'

export type AgenticSearchLivecrawlMode = 'fallback' | 'preferred'

export type AgenticSearchBudget = {
  maxRounds: number
  maxSearches: number
  maxFetches: number
  maxParallelFetches: number
  maxEvidenceChars: number
  maxContextChars: number
}

export type AgenticSearchPlannerInput = {
  task: string
  effort?: AgenticSearchEffort
  allowedDomains?: string[]
  blockedDomains?: string[]
  preferredSources?: AgenticSearchSourceKind[]
  now?: number
}

export type AgenticSearchPlanStep = {
  id: string
  round: number
  source: AgenticSearchSourceKind
  query: string
  purpose: string
  priority: number
  maxResults?: number
  fetchLimit?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
  searchType?: AgenticSearchSearchType
  livecrawl?: AgenticSearchLivecrawlMode
  contextMaxCharacters?: number
}

export type AgenticSearchPlan = {
  id: string
  task: string
  effort: AgenticSearchEffort
  intent: AgenticSearchIntent
  budget: AgenticSearchBudget
  evidenceRequirements: AgenticSearchEvidenceRequirement[]
  steps: AgenticSearchPlanStep[]
  mustCrossCheck: boolean
  createdAt: number
}

export type AgenticSearchPlanSummary = {
  planId: string
  intent: AgenticSearchIntent
  effort: AgenticSearchEffort
  stepCount: number
  webSearchCount: number
  webFetchCount: number
  mcpSearchCount: number
  localSearchCount: number
  bashSearchCount: number
  maxRound: number
  evidenceRequirements: AgenticSearchEvidenceRequirement[]
  mustCrossCheck: boolean
  maxEvidenceChars: number
  maxContextChars: number
}

export type AgenticSearchFailureKind =
  | 'unsupported_source'
  | 'search_failed'
  | 'fetch_failed'
  | 'fetch_budget_exhausted'
  | 'source_failed'
  | 'private_url_skipped'

export type AgenticSearchFailure = {
  kind: AgenticSearchFailureKind
  stepId: string
  round: number
  source: AgenticSearchSourceKind
  message: string
  retryable: boolean
  url?: string
}

export type AgenticSearchHit = {
  title: string
  url: string
  snippet?: string
  query: string
  stepId: string
  round: number
  rank: number
}

export type AgenticSearchFetchedEvidence = {
  source: AgenticSearchSourceKind
  url?: string
  title?: string
  query: string
  stepId: string
  round: number
  status: 'fetched' | 'collected'
  content: string
  chars: number
  durationMs: number
}

export type AgenticSearchSourceType =
  | 'primary'
  | 'independent'
  | 'local'
  | 'private'
  | 'unknown'

export type AgenticSearchClaimPolarity = 'supports' | 'contradicts' | 'neutral'

export type AgenticSearchEvidenceClaim = {
  id: string
  evidenceIndex: number
  source: AgenticSearchSourceKind
  sourceType: AgenticSearchSourceType
  title?: string
  url?: string
  date?: string
  claim: string
  snippet: string
  polarity: AgenticSearchClaimPolarity
  supportStrength: number
  citationId: string
}

export type AgenticSearchConflictGroup = {
  id: string
  topic: string
  claimIds: string[]
  polarities: AgenticSearchClaimPolarity[]
}

export type AgenticSearchCrossCheckSummary = {
  claimCount: number
  primaryClaimCount: number
  independentClaimCount: number
  localClaimCount: number
  privateClaimCount: number
  conflictCount: number
  hasPrimarySupport: boolean
  hasIndependentCrossCheck: boolean
  crossCheckCoverage: number
}

export type AgenticSearchEvidenceExtraction = {
  claims: AgenticSearchEvidenceClaim[]
  conflictGroups: AgenticSearchConflictGroup[]
  summary: AgenticSearchCrossCheckSummary
}

export type AgenticSearchRoundResult = {
  round: number
  stepIds: string[]
  searchHits: AgenticSearchHit[]
  fetchedEvidence: AgenticSearchFetchedEvidence[]
  failures: AgenticSearchFailure[]
  durationMs: number
}

export type AgenticSearchExecutionMetrics = {
  rounds: number
  maxFetchConcurrency: number
  searchCount: number
  fetchCount: number
  sourceEvidenceCount: number
  failedSearchCount: number
  failedFetchCount: number
  failedSourceCount: number
  privateUrlSkippedCount: number
  uniqueUrlCount: number
  evidenceChars: number
  evidenceClaimCount: number
  primaryClaimCount: number
  independentClaimCount: number
  conflictCount: number
  crossCheckCoverage: number
  citationCount: number
  citationCompressionRatio: number
  estimatedInputTokens: number
  estimatedCostUsd: number
  comparisonMode: 'agentic_search'
  durationMs: number
}

export type AgenticSearchEvidencePack = {
  text: string
  claims: AgenticSearchEvidenceClaim[]
  conflictGroups: AgenticSearchConflictGroup[]
  metadata: AgenticSearchEvidencePackMetadata
}

export type AgenticSearchEvidencePackMetadata = {
  packChars: number
  budgetChars: number
  citationCount: number
  truncatedClaimCount: number
  primaryClaimCount: number
  independentClaimCount: number
  conflictCount: number
  crossCheckCoverage: number
  estimatedInputTokens: number
  estimatedCostUsd: number
  citationCompressionRatio: number
  recommendedInjectionTarget: 'context_packer' | 'query_loop' | 'agent_task'
}

export type AgenticSearchIntegrationTarget =
  | 'context_packer'
  | 'query_loop'
  | 'agent_task'

export type AgenticSearchEvidencePackIntegration = {
  target: AgenticSearchIntegrationTarget
  text: string
  metadata: AgenticSearchEvidencePackMetadata & {
    planId: string
    effort: AgenticSearchEffort
    task: string
  }
  citations: {
    citationId: string
    sourceType: AgenticSearchSourceType
    url?: string
    title?: string
    date?: string
    snippet: string
  }[]
}

export type AgenticSearchExecutionResult = {
  plan: AgenticSearchPlan
  rounds: AgenticSearchRoundResult[]
  searchHits: AgenticSearchHit[]
  fetchedEvidence: AgenticSearchFetchedEvidence[]
  failures: AgenticSearchFailure[]
  evidenceExtraction: AgenticSearchEvidenceExtraction
  evidencePack: AgenticSearchEvidencePack
  metrics: AgenticSearchExecutionMetrics
}

export type AgenticSearchWebSearchRequest = {
  query: string
  allowedDomains?: string[]
  blockedDomains?: string[]
  numResults?: number
  livecrawl?: AgenticSearchLivecrawlMode
  searchType?: AgenticSearchSearchType
  contextMaxCharacters?: number
}

export type AgenticSearchWebSearchResponse = {
  hits: {
    title: string
    url: string
    snippet?: string
  }[]
}

export type AgenticSearchWebFetchRequest = {
  url: string
  prompt: string
  contextMaxCharacters?: number
}

export type AgenticSearchWebFetchResponse = {
  content: string
  title?: string
  durationMs?: number
}

export type AgenticSearchSourceRequest = {
  source: Exclude<AgenticSearchSourceKind, 'web_search' | 'web_fetch'>
  query: string
  purpose: string
  stepId: string
  round: number
  contextMaxCharacters?: number
  urls?: string[]
}

export type AgenticSearchSourceResponse = {
  evidence: {
    title?: string
    url?: string
    content: string
    durationMs?: number
  }[]
}

export type AgenticSearchExecutorAdapters = {
  webSearch: (
    request: AgenticSearchWebSearchRequest,
  ) => Promise<AgenticSearchWebSearchResponse>
  webFetch: (
    request: AgenticSearchWebFetchRequest,
  ) => Promise<AgenticSearchWebFetchResponse>
  sourceRunner?: (
    request: AgenticSearchSourceRequest,
  ) => Promise<AgenticSearchSourceResponse>
  now?: () => number
}
