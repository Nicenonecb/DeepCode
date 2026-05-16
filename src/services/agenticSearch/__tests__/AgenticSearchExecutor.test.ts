import { describe, expect, test } from 'bun:test'
import { createAgenticSearchPlan } from '../AgenticSearchPlanner.js'
import { runAgenticSearchPlan } from '../AgenticSearchExecutor.js'
import type {
  AgenticSearchExecutorAdapters,
  AgenticSearchSourceRequest,
  AgenticSearchWebFetchRequest,
  AgenticSearchWebSearchRequest,
} from '../types.js'

describe('AgenticSearchExecutor', () => {
  test('executes web search rounds and fetches top URLs with bounded parallelism', async () => {
    const searchRequests: AgenticSearchWebSearchRequest[] = []
    const fetchRequests: AgenticSearchWebFetchRequest[] = []
    let inFlightFetches = 0
    let maxInFlightFetches = 0
    let now = 1_000

    const plan = createAgenticSearchPlan({
      task: 'Verify latest provider API docs with independent evidence',
      effort: 'deep',
      now,
    })

    const adapters: AgenticSearchExecutorAdapters = {
      now: () => now++,
      async webSearch(request) {
        searchRequests.push(request)
        return {
          hits: [
            {
              title: `Primary ${searchRequests.length}`,
              url: `https://example.com/source-${searchRequests.length}`,
              snippet: 'primary evidence',
            },
            {
              title: `Duplicate ${searchRequests.length}`,
              url: 'https://example.com/source-duplicate#section',
              snippet: 'duplicate evidence',
            },
          ],
        }
      },
      async webFetch(request) {
        fetchRequests.push(request)
        inFlightFetches += 1
        maxInFlightFetches = Math.max(maxInFlightFetches, inFlightFetches)
        await Promise.resolve()
        inFlightFetches -= 1
        return {
          title: `Fetched ${request.url}`,
          content: 'x'.repeat((request.contextMaxCharacters ?? 100) + 25),
          durationMs: 7,
        }
      },
    }

    const result = await runAgenticSearchPlan(plan, adapters)

    expect(searchRequests.length).toBeGreaterThan(1)
    expect(fetchRequests.length).toBeGreaterThan(0)
    expect(fetchRequests.length).toBeLessThanOrEqual(plan.budget.maxFetches)
    expect(maxInFlightFetches).toBeLessThanOrEqual(
      plan.budget.maxParallelFetches,
    )
    expect(result.rounds.map(round => round.round)).toEqual([1, 2, 3])
    expect(
      result.fetchedEvidence.every(item => item.status === 'fetched'),
    ).toBe(true)
    expect(
      result.fetchedEvidence.every(
        item =>
          item.content.length <=
          (plan.steps.find(step => step.id === item.stepId)
            ?.contextMaxCharacters ?? Number.POSITIVE_INFINITY),
      ),
    ).toBe(true)
    expect(result.metrics.fetchCount).toBe(result.fetchedEvidence.length)
    expect(result.metrics.uniqueUrlCount).toBeLessThan(result.searchHits.length)
    expect(result.evidenceExtraction.summary.claimCount).toBeGreaterThan(0)
    expect(result.evidencePack.text).toContain('<agentic_search_evidence>')
    expect(result.metrics.maxFetchConcurrency).toBe(maxInFlightFetches)
    expect(result.metrics.evidenceClaimCount).toBe(
      result.evidenceExtraction.summary.claimCount,
    )
    expect(result.metrics.citationCount).toBe(
      result.evidencePack.metadata.citationCount,
    )
    expect(result.metrics.comparisonMode).toBe('agentic_search')
  })

  test('records search failures and still executes later rounds', async () => {
    const plan = createAgenticSearchPlan({
      task: 'Verify API documentation with citations',
      effort: 'balanced',
      now: 1,
    })
    let searchCount = 0

    const result = await runAgenticSearchPlan(plan, {
      async webSearch() {
        searchCount += 1
        if (searchCount === 1) {
          throw new Error('search backend unavailable')
        }
        return {
          hits: [
            {
              title: 'Docs',
              url: 'https://docs.example.com',
            },
          ],
        }
      },
      async webFetch(request) {
        return {
          content: `fetched ${request.url}`,
        }
      },
    })

    expect(
      result.failures.some(failure => failure.kind === 'search_failed'),
    ).toBe(true)
    expect(result.fetchedEvidence.length).toBeGreaterThan(0)
    expect(result.metrics.failedSearchCount).toBe(1)
  })

  test('records fetch failures without dropping successful evidence', async () => {
    const plan = createAgenticSearchPlan({
      task: 'Verify current provider docs with evidence',
      effort: 'balanced',
      now: 1,
    })

    const result = await runAgenticSearchPlan(plan, {
      async webSearch() {
        return {
          hits: [
            { title: 'Good', url: 'https://example.com/good' },
            { title: 'Bad', url: 'https://example.com/bad' },
          ],
        }
      },
      async webFetch(request) {
        if (request.url.endsWith('/bad')) {
          throw new Error('fetch failed')
        }
        return {
          content: 'good evidence',
        }
      },
    })

    expect(result.fetchedEvidence.map(item => item.url)).toContain(
      'https://example.com/good',
    )
    expect(
      result.failures.some(failure => failure.kind === 'fetch_failed'),
    ).toBe(true)
    expect(result.metrics.failedFetchCount).toBe(1)
  })

  test('runs MCP, local, and Bash source runner steps as collected evidence', async () => {
    const sourceRequests: AgenticSearchSourceRequest[] = []
    const plan = createAgenticSearchPlan({
      task: 'Search internal GitHub MCP, local repo tests, and Bash benchmark scripts for rollout notes',
      effort: 'balanced',
      now: 1,
    })

    const result = await runAgenticSearchPlan(plan, {
      async webSearch() {
        return { hits: [] }
      },
      async webFetch() {
        return { content: '' }
      },
      async sourceRunner(request) {
        sourceRequests.push(request)
        return {
          evidence: [
            {
              title: `${request.source} evidence`,
              content: `${request.source} collected evidence`,
              durationMs: 3,
            },
          ],
        }
      },
    })

    expect(sourceRequests.map(request => request.source)).toContain(
      'mcp_search',
    )
    expect(sourceRequests.map(request => request.source)).toContain(
      'local_search',
    )
    expect(sourceRequests.map(request => request.source)).toContain(
      'bash_search',
    )
    expect(result.fetchedEvidence.map(item => item.status)).toContain(
      'collected',
    )
    expect(result.metrics.sourceEvidenceCount).toBeGreaterThanOrEqual(3)
    expect(result.metrics.failedSourceCount).toBe(0)
  })

  test('skips authenticated or private URLs instead of WebFetching them', async () => {
    const fetchRequests: AgenticSearchWebFetchRequest[] = []
    const plan = createAgenticSearchPlan({
      task: 'Verify current provider docs with evidence',
      effort: 'balanced',
      now: 1,
    })

    const result = await runAgenticSearchPlan(plan, {
      async webSearch() {
        return {
          hits: [
            { title: 'Private GitHub', url: 'https://github.com/acme/private' },
            { title: 'Jira', url: 'https://acme.atlassian.net/browse/ENG-1' },
            { title: 'Public docs', url: 'https://example.com/public-docs' },
          ],
        }
      },
      async webFetch(request) {
        fetchRequests.push(request)
        return {
          content: `public evidence ${request.url}`,
        }
      },
    })

    expect(fetchRequests.map(request => request.url)).toEqual([
      'https://example.com/public-docs',
    ])
    expect(result.metrics.privateUrlSkippedCount).toBeGreaterThanOrEqual(2)
    expect(
      result.failures.every(
        failure =>
          failure.kind !== 'private_url_skipped' ||
          failure.message.includes('MCP/local source runner'),
      ),
    ).toBe(true)
  })

  test('reports unsupported sources when no source runner is configured', async () => {
    const plan = createAgenticSearchPlan({
      task: 'Search internal GitHub MCP and Confluence for rollout notes',
      effort: 'balanced',
      now: 1,
    })

    const result = await runAgenticSearchPlan(plan, {
      async webSearch() {
        return { hits: [] }
      },
      async webFetch() {
        return { content: '' }
      },
    })

    expect(
      result.failures.some(
        failure =>
          failure.kind === 'unsupported_source' &&
          failure.source === 'mcp_search',
      ),
    ).toBe(true)
  })
})
