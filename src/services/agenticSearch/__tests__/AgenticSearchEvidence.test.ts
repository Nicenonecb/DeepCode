import { describe, expect, test } from 'bun:test'
import { extractAgenticSearchEvidence } from '../AgenticSearchEvidence.js'
import type { AgenticSearchFetchedEvidence } from '../types.js'

describe('AgenticSearchEvidence', () => {
  test('extracts citation-ready claims with source type and dates', () => {
    const extraction = extractAgenticSearchEvidence([
      evidence({
        source: 'web_fetch',
        url: 'https://api.deepseek.com/docs/v4/tools',
        title: 'DeepSeek API docs 2026-05-01',
        content:
          'DeepSeek V4 supports DSML tools by default in 2026-05-01. The provider supports citation evidence.',
      }),
      evidence({
        source: 'web_fetch',
        url: 'https://example.org/analysis/deepseek-v4',
        title: 'Independent analysis',
        content:
          'Independent benchmark confirms DeepSeek V4 supports DSML tools. It is available for agentic workflows.',
      }),
      evidence({
        source: 'mcp_search',
        title: 'Private rollout note',
        content:
          'Internal rollout note confirms DSML is enabled for private provider tenants.',
      }),
      evidence({
        source: 'local_search',
        title: 'Local test fixture',
        content:
          'Local fixture says native OpenAI tools are not the default for V4 Pro.',
      }),
    ])

    expect(extraction.claims.length).toBeGreaterThan(3)
    expect(extraction.summary.primaryClaimCount).toBeGreaterThan(0)
    expect(extraction.summary.independentClaimCount).toBeGreaterThan(0)
    expect(extraction.summary.privateClaimCount).toBeGreaterThan(0)
    expect(extraction.summary.localClaimCount).toBeGreaterThan(0)
    expect(extraction.summary.hasPrimarySupport).toBe(true)
    expect(extraction.summary.hasIndependentCrossCheck).toBe(true)
    expect(extraction.claims[0]?.date).toBe('2026-05-01')
    expect(extraction.claims.every(claim => claim.snippet.length <= 360)).toBe(
      true,
    )
  })

  test('groups conflicting support and contradiction claims', () => {
    const extraction = extractAgenticSearchEvidence([
      evidence({
        source: 'web_fetch',
        url: 'https://docs.example.com/provider',
        content: 'Provider supports tool calling by default.',
      }),
      evidence({
        source: 'web_fetch',
        url: 'https://news.example.net/provider',
        content: 'Provider does not support tool calling by default.',
      }),
    ])

    expect(extraction.conflictGroups.length).toBeGreaterThan(0)
    expect(extraction.summary.conflictCount).toBeGreaterThan(0)
    expect(extraction.conflictGroups[0]?.polarities).toContain('supports')
    expect(extraction.conflictGroups[0]?.polarities).toContain('contradicts')
  })
})

function evidence(
  overrides: Partial<AgenticSearchFetchedEvidence>,
): AgenticSearchFetchedEvidence {
  return {
    source: 'web_fetch',
    query: 'DeepSeek V4 tools',
    stepId: 'step-1',
    round: 1,
    status: 'fetched',
    content: '',
    chars: overrides.content?.length ?? 0,
    durationMs: 1,
    ...overrides,
  }
}
