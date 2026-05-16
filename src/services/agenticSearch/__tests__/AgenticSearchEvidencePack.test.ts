import { describe, expect, test } from 'bun:test'
import { createAgenticSearchPlan } from '../AgenticSearchPlanner.js'
import { extractAgenticSearchEvidence } from '../AgenticSearchEvidence.js'
import {
  createAgenticSearchEvidencePack,
  createAgenticSearchEvidencePackIntegration,
} from '../AgenticSearchEvidencePack.js'
import type { AgenticSearchFetchedEvidence } from '../types.js'

describe('AgenticSearchEvidencePack', () => {
  test('keeps primary and independent evidence with stable citation ids', () => {
    const plan = createAgenticSearchPlan({
      task: 'Verify DeepSeek V4 DSML evidence',
      effort: 'deep',
      now: 1,
    })
    const extraction = extractAgenticSearchEvidence([
      evidence({
        url: 'https://api.deepseek.com/docs/v4/tools',
        title: 'Primary docs',
        content: 'DeepSeek V4 supports DSML tools by default.',
      }),
      evidence({
        url: 'https://example.com/independent',
        title: 'Independent source',
        content: 'Independent testing confirms DSML tools are available.',
      }),
    ])

    const pack = createAgenticSearchEvidencePack({ plan, extraction })

    expect(pack.text).toContain('<agentic_search_evidence>')
    expect(pack.text).toContain('[A1.1]')
    expect(pack.text).toContain('[A2.1]')
    expect(pack.metadata.primaryClaimCount).toBeGreaterThan(0)
    expect(pack.metadata.independentClaimCount).toBeGreaterThan(0)
    expect(pack.metadata.citationCount).toBe(pack.claims.length)
    expect(pack.metadata.packChars).toBe(pack.text.length)
    expect(pack.metadata.citationCompressionRatio).toBe(1)
    expect(pack.metadata.estimatedCostUsd).toBeGreaterThan(0)
    expect(
      createAgenticSearchEvidencePackIntegration({
        plan,
        pack,
        target: 'agent_task',
      }),
    ).toMatchObject({
      target: 'agent_task',
      metadata: {
        planId: plan.id,
        effort: 'deep',
        task: plan.task,
      },
      citations: [
        expect.objectContaining({
          citationId: 'A1.1',
          sourceType: 'primary',
        }),
        expect.objectContaining({
          citationId: 'A2.1',
          sourceType: 'independent',
        }),
      ],
    })
  })

  test('truncates low-priority evidence within fast effort budget', () => {
    const plan = createAgenticSearchPlan({
      task: 'Quick API check',
      effort: 'fast',
      now: 1,
    })
    const extraction = extractAgenticSearchEvidence(
      Array.from({ length: 80 }, (_, index) =>
        evidence({
          url: `https://example.com/source-${index}`,
          content: `Independent source ${index} supports the claim with a long citation snippet. ${'x'.repeat(200)}`,
        }),
      ),
    )

    const pack = createAgenticSearchEvidencePack({ plan, extraction })

    expect(pack.metadata.packChars).toBeLessThanOrEqual(
      pack.metadata.budgetChars,
    )
    expect(pack.metadata.truncatedClaimCount).toBeGreaterThan(0)
    expect(pack.metadata.estimatedInputTokens).toBeGreaterThan(0)
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
