import type {
  AgenticSearchEvidenceExtraction,
  AgenticSearchEvidencePack,
  AgenticSearchExecutionMetrics,
  AgenticSearchExecutionResult,
  AgenticSearchExecutorAdapters,
  AgenticSearchFailure,
  AgenticSearchFetchedEvidence,
  AgenticSearchHit,
  AgenticSearchPlan,
  AgenticSearchPlanStep,
  AgenticSearchRoundResult,
  AgenticSearchSourceKind,
  AgenticSearchSourceRequest,
  AgenticSearchWebFetchRequest,
} from './types.js'
import { extractAgenticSearchEvidence } from './AgenticSearchEvidence.js'
import { createAgenticSearchEvidencePack } from './AgenticSearchEvidencePack.js'

export class AgenticSearchExecutor {
  private readonly adapters: AgenticSearchExecutorAdapters

  constructor(adapters: AgenticSearchExecutorAdapters) {
    this.adapters = adapters
  }

  async run(plan: AgenticSearchPlan): Promise<AgenticSearchExecutionResult> {
    const startedAt = this.now()
    const rounds: AgenticSearchRoundResult[] = []
    const seenUrls = new Set<string>()
    const fetchedUrls = new Set<string>()
    const candidateHits: AgenticSearchHit[] = []
    let remainingFetches = plan.budget.maxFetches
    let maxFetchConcurrency = 0

    for (const roundNumber of getRoundNumbers(plan)) {
      const roundStartedAt = this.now()
      const roundSteps = plan.steps.filter(step => step.round === roundNumber)
      const roundSearchHits: AgenticSearchHit[] = []
      const roundFetchedEvidence: AgenticSearchFetchedEvidence[] = []
      const roundFailures: AgenticSearchFailure[] = []

      for (const step of roundSteps) {
        if (step.source === 'web_search') {
          const searchResult = await this.runSearchStep(step)
          roundSearchHits.push(...searchResult.hits)
          roundFailures.push(...searchResult.failures)
        } else if (isSourceRunnerStep(step)) {
          const sourceResult = await this.runSourceStep(step)
          roundFetchedEvidence.push(...sourceResult.evidence)
          roundFailures.push(...sourceResult.failures)
        }
      }

      for (const hit of roundSearchHits) {
        const normalizedUrl = normalizeUrl(hit.url)
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl)
          candidateHits.push(hit)
        }
      }

      const fetchSteps = roundSteps.filter(step => step.source === 'web_fetch')
      for (const step of fetchSteps) {
        if (remainingFetches <= 0) {
          roundFailures.push({
            kind: 'fetch_budget_exhausted',
            stepId: step.id,
            round: step.round,
            source: step.source,
            message: 'Fetch budget exhausted before this step could run.',
            retryable: false,
          })
          continue
        }

        const selection = selectFetchCandidates(
          candidateHits,
          fetchedUrls,
          step,
          remainingFetches,
          plan.budget.maxParallelFetches,
        )
        roundFailures.push(...selection.failures)
        const hitsToFetch = selection.hits
        remainingFetches -= hitsToFetch.length
        maxFetchConcurrency = Math.max(maxFetchConcurrency, hitsToFetch.length)
        const fetchResult = await this.runFetchBatch(step, hitsToFetch)
        roundFetchedEvidence.push(...fetchResult.evidence)
        for (const evidence of fetchResult.evidence) {
          if (evidence.url) {
            fetchedUrls.add(normalizeUrl(evidence.url))
          }
        }
        roundFailures.push(...fetchResult.failures)
      }

      rounds.push({
        round: roundNumber,
        stepIds: roundSteps.map(step => step.id),
        searchHits: roundSearchHits,
        fetchedEvidence: roundFetchedEvidence,
        failures: roundFailures,
        durationMs: this.now() - roundStartedAt,
      })
    }

    const searchHits = rounds.flatMap(round => round.searchHits)
    const fetchedEvidence = rounds.flatMap(round => round.fetchedEvidence)
    const failures = rounds.flatMap(round => round.failures)
    const evidenceExtraction = extractAgenticSearchEvidence(fetchedEvidence)
    const evidencePack = createAgenticSearchEvidencePack({
      plan,
      extraction: evidenceExtraction,
    })

    return {
      plan,
      rounds,
      searchHits,
      fetchedEvidence,
      failures,
      evidenceExtraction,
      evidencePack,
      metrics: buildMetrics({
        plan,
        rounds,
        searchHits,
        fetchedEvidence,
        failures,
        evidenceExtraction,
        evidencePack,
        maxFetchConcurrency,
        durationMs: this.now() - startedAt,
      }),
    }
  }

  private async runSearchStep(step: AgenticSearchPlanStep): Promise<{
    hits: AgenticSearchHit[]
    failures: AgenticSearchFailure[]
  }> {
    try {
      const result = await this.adapters.webSearch({
        query: step.query,
        allowedDomains: step.allowedDomains,
        blockedDomains: step.blockedDomains,
        numResults: step.maxResults,
        livecrawl: step.livecrawl,
        searchType: step.searchType,
        contextMaxCharacters: step.contextMaxCharacters,
      })

      return {
        hits: result.hits.map((hit, index) => ({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          query: step.query,
          stepId: step.id,
          round: step.round,
          rank: index + 1,
        })),
        failures: [],
      }
    } catch (error) {
      return {
        hits: [],
        failures: [
          {
            kind: 'search_failed',
            stepId: step.id,
            round: step.round,
            source: step.source,
            message: errorMessage(error),
            retryable: true,
          },
        ],
      }
    }
  }

  private async runFetchBatch(
    step: AgenticSearchPlanStep,
    hits: AgenticSearchHit[],
  ): Promise<{
    evidence: AgenticSearchFetchedEvidence[]
    failures: AgenticSearchFailure[]
  }> {
    const requests = hits.map(hit => this.buildFetchRequest(step, hit))
    const settled = await Promise.allSettled(
      requests.map(async ({ hit, request }) => {
        const startedAt = this.now()
        const response = await this.adapters.webFetch(request)
        const content = trimToBudget(
          response.content,
          step.contextMaxCharacters,
        )

        return {
          source: 'web_fetch' as const,
          url: hit.url,
          title: response.title || hit.title,
          query: hit.query,
          stepId: step.id,
          round: step.round,
          status: 'fetched' as const,
          content,
          chars: content.length,
          durationMs: response.durationMs ?? this.now() - startedAt,
        }
      }),
    )

    const evidence: AgenticSearchFetchedEvidence[] = []
    const failures: AgenticSearchFailure[] = []

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        evidence.push(result.value)
        return
      }

      failures.push({
        kind: 'fetch_failed',
        stepId: step.id,
        round: step.round,
        source: step.source,
        message: errorMessage(result.reason),
        retryable: true,
        url: hits[index]?.url,
      })
    })

    return { evidence, failures }
  }

  private async runSourceStep(step: AgenticSearchPlanStep): Promise<{
    evidence: AgenticSearchFetchedEvidence[]
    failures: AgenticSearchFailure[]
  }> {
    if (!this.adapters.sourceRunner || !isSourceRunnerStep(step)) {
      return {
        evidence: [],
        failures: [
          {
            kind: 'unsupported_source',
            stepId: step.id,
            round: step.round,
            source: step.source,
            message: `${step.source} is planned but no sourceRunner adapter is configured.`,
            retryable: false,
          },
        ],
      }
    }

    const startedAt = this.now()
    const request: AgenticSearchSourceRequest = {
      source: step.source,
      query: step.query,
      purpose: step.purpose,
      stepId: step.id,
      round: step.round,
      contextMaxCharacters: step.contextMaxCharacters,
    }

    try {
      const response = await this.adapters.sourceRunner(request)
      const evidence = response.evidence.map(item => {
        const content = trimToBudget(item.content, step.contextMaxCharacters)
        return {
          source: step.source,
          url: item.url,
          title: item.title,
          query: step.query,
          stepId: step.id,
          round: step.round,
          status: 'collected' as const,
          content,
          chars: content.length,
          durationMs: item.durationMs ?? this.now() - startedAt,
        }
      })

      return { evidence, failures: [] }
    } catch (error) {
      return {
        evidence: [],
        failures: [
          {
            kind: 'source_failed',
            stepId: step.id,
            round: step.round,
            source: step.source,
            message: errorMessage(error),
            retryable: true,
          },
        ],
      }
    }
  }

  private buildFetchRequest(
    step: AgenticSearchPlanStep,
    hit: AgenticSearchHit,
  ): {
    hit: AgenticSearchHit
    request: AgenticSearchWebFetchRequest
  } {
    return {
      hit,
      request: {
        url: hit.url,
        prompt: [
          step.purpose,
          'Extract concise evidence for the search task.',
          'Keep source dates, claims, limitations, and citation-worthy snippets.',
        ].join(' '),
        contextMaxCharacters: step.contextMaxCharacters,
      },
    }
  }

  private now(): number {
    return this.adapters.now?.() ?? Date.now()
  }
}

export async function runAgenticSearchPlan(
  plan: AgenticSearchPlan,
  adapters: AgenticSearchExecutorAdapters,
): Promise<AgenticSearchExecutionResult> {
  return new AgenticSearchExecutor(adapters).run(plan)
}

function getRoundNumbers(plan: AgenticSearchPlan): number[] {
  return [...new Set(plan.steps.map(step => step.round))].sort((a, b) => a - b)
}

function selectFetchCandidates(
  candidateHits: AgenticSearchHit[],
  fetchedUrls: Set<string>,
  step: AgenticSearchPlanStep,
  remainingFetches: number,
  maxParallelFetches: number,
): { hits: AgenticSearchHit[]; failures: AgenticSearchFailure[] } {
  const limit = Math.min(
    step.fetchLimit ?? maxParallelFetches,
    maxParallelFetches,
    remainingFetches,
  )
  const failures: AgenticSearchFailure[] = []
  const hits: AgenticSearchHit[] = []

  for (const hit of candidateHits) {
    if (hits.length >= Math.max(0, limit)) {
      break
    }
    if (fetchedUrls.has(normalizeUrl(hit.url))) {
      continue
    }
    if (isAuthenticatedOrPrivateUrl(hit.url)) {
      fetchedUrls.add(normalizeUrl(hit.url))
      failures.push({
        kind: 'private_url_skipped',
        stepId: step.id,
        round: step.round,
        source: step.source,
        message:
          'Skipped WebFetch for an authenticated or private URL; route it through MCP/local source runner instead.',
        retryable: false,
        url: hit.url,
      })
      continue
    }
    hits.push(hit)
  }

  return { hits, failures }
}

function buildMetrics({
  plan,
  rounds,
  searchHits,
  fetchedEvidence,
  failures,
  evidenceExtraction,
  evidencePack,
  maxFetchConcurrency,
  durationMs,
}: {
  plan: AgenticSearchPlan
  rounds: AgenticSearchRoundResult[]
  searchHits: AgenticSearchHit[]
  fetchedEvidence: AgenticSearchFetchedEvidence[]
  failures: AgenticSearchFailure[]
  evidenceExtraction: AgenticSearchEvidenceExtraction
  evidencePack: AgenticSearchEvidencePack
  maxFetchConcurrency: number
  durationMs: number
}): AgenticSearchExecutionMetrics {
  return {
    rounds: rounds.length,
    maxFetchConcurrency,
    searchCount: plan.steps.filter(step => step.source === 'web_search').length,
    fetchCount: fetchedEvidence.filter(
      evidence => evidence.source === 'web_fetch',
    ).length,
    sourceEvidenceCount: fetchedEvidence.filter(
      evidence => evidence.source !== 'web_fetch',
    ).length,
    failedSearchCount: failures.filter(
      failure => failure.kind === 'search_failed',
    ).length,
    failedFetchCount: failures.filter(
      failure =>
        failure.kind === 'fetch_failed' ||
        failure.kind === 'fetch_budget_exhausted',
    ).length,
    failedSourceCount: failures.filter(
      failure =>
        failure.kind === 'source_failed' ||
        failure.kind === 'unsupported_source',
    ).length,
    privateUrlSkippedCount: failures.filter(
      failure => failure.kind === 'private_url_skipped',
    ).length,
    uniqueUrlCount: new Set(searchHits.map(hit => normalizeUrl(hit.url))).size,
    evidenceChars: fetchedEvidence.reduce(
      (total, evidence) => total + evidence.chars,
      0,
    ),
    evidenceClaimCount: evidenceExtraction.summary.claimCount,
    primaryClaimCount: evidenceExtraction.summary.primaryClaimCount,
    independentClaimCount: evidenceExtraction.summary.independentClaimCount,
    conflictCount: evidenceExtraction.summary.conflictCount,
    crossCheckCoverage: evidenceExtraction.summary.crossCheckCoverage,
    citationCount: evidencePack.metadata.citationCount,
    citationCompressionRatio: evidencePack.metadata.citationCompressionRatio,
    estimatedInputTokens: evidencePack.metadata.estimatedInputTokens,
    estimatedCostUsd: evidencePack.metadata.estimatedCostUsd,
    comparisonMode: 'agentic_search',
    durationMs,
  }
}

function isSourceRunnerStep(
  step: AgenticSearchPlanStep,
): step is AgenticSearchPlanStep & {
  source: Exclude<AgenticSearchSourceKind, 'web_search' | 'web_fetch'>
} {
  return ['mcp_search', 'local_search', 'bash_search'].includes(step.source)
}

function isAuthenticatedOrPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const privateHosts = [
      'github.com',
      'gitlab.com',
      'bitbucket.org',
      'jira',
      'atlassian.net',
      'confluence',
      'notion.so',
      'docs.google.com',
      'drive.google.com',
      'slack.com',
      'linear.app',
    ]
    return (
      privateHosts.some(privateHost => host.includes(privateHost)) ||
      host.endsWith('.internal') ||
      host.endsWith('.local') ||
      host.includes('localhost') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    )
  } catch {
    return false
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

function trimToBudget(content: string, maxCharacters?: number): string {
  if (!maxCharacters || content.length <= maxCharacters) {
    return content
  }
  return content.slice(0, Math.max(0, maxCharacters))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
