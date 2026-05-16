import type {
  AgenticSearchEvidenceClaim,
  AgenticSearchEvidenceExtraction,
  AgenticSearchEvidencePack,
  AgenticSearchEvidencePackIntegration,
  AgenticSearchEvidencePackMetadata,
  AgenticSearchIntegrationTarget,
  AgenticSearchPlan,
} from './types.js'

const CHARS_PER_TOKEN_ESTIMATE = 4
const ESTIMATED_INPUT_COST_PER_MILLION_TOKENS_USD = 0.2

export function createAgenticSearchEvidencePack({
  plan,
  extraction,
}: {
  plan: AgenticSearchPlan
  extraction: AgenticSearchEvidenceExtraction
}): AgenticSearchEvidencePack {
  const budgetChars = packBudgetChars(plan)
  const rankedClaims = rankClaims(extraction.claims)
  const selectedClaims: AgenticSearchEvidenceClaim[] = []
  const lines: string[] = [
    '<agentic_search_evidence>',
    `task: ${plan.task}`,
    `effort: ${plan.effort}`,
    `cross_check_coverage: ${extraction.summary.crossCheckCoverage}`,
  ]
  let usedChars = lines.join('\n').length + '</agentic_search_evidence>'.length

  for (const claim of rankedClaims) {
    const line = formatClaimLine(claim)
    if (usedChars + line.length + 1 > budgetChars) {
      continue
    }
    selectedClaims.push(claim)
    lines.push(line)
    usedChars += line.length + 1
  }

  if (extraction.conflictGroups.length > 0) {
    lines.push('conflicts:')
    for (const group of extraction.conflictGroups) {
      const line = `- ${group.id}: ${group.topic} (${group.claimIds.join(', ')})`
      if (usedChars + line.length + 1 <= budgetChars) {
        lines.push(line)
        usedChars += line.length + 1
      }
    }
  }

  lines.push('</agentic_search_evidence>')
  const text = lines.join('\n')

  return {
    text,
    claims: selectedClaims,
    conflictGroups: extraction.conflictGroups,
    metadata: packMetadata({
      text,
      budgetChars,
      selectedClaims,
      extraction,
    }),
  }
}

export function createAgenticSearchEvidencePackIntegration({
  plan,
  pack,
  target,
}: {
  plan: AgenticSearchPlan
  pack: AgenticSearchEvidencePack
  target?: AgenticSearchIntegrationTarget
}): AgenticSearchEvidencePackIntegration {
  return {
    target: target ?? pack.metadata.recommendedInjectionTarget,
    text: pack.text,
    metadata: {
      ...pack.metadata,
      planId: plan.id,
      effort: plan.effort,
      task: plan.task,
    },
    citations: pack.claims.map(claim => ({
      citationId: claim.citationId,
      sourceType: claim.sourceType,
      ...(claim.url ? { url: claim.url } : {}),
      ...(claim.title ? { title: claim.title } : {}),
      ...(claim.date ? { date: claim.date } : {}),
      snippet: claim.snippet,
    })),
  }
}

function packBudgetChars(plan: AgenticSearchPlan): number {
  const divisor =
    plan.effort === 'deep' ? 2 : plan.effort === 'balanced' ? 3 : 4
  return Math.max(2_000, Math.floor(plan.budget.maxEvidenceChars / divisor))
}

function rankClaims(
  claims: AgenticSearchEvidenceClaim[],
): AgenticSearchEvidenceClaim[] {
  return [...claims].sort((left, right) => {
    const sourceDelta = sourceRank(right) - sourceRank(left)
    if (sourceDelta !== 0) return sourceDelta
    const strengthDelta = right.supportStrength - left.supportStrength
    if (strengthDelta !== 0) return strengthDelta
    return left.id.localeCompare(right.id)
  })
}

function sourceRank(claim: AgenticSearchEvidenceClaim): number {
  if (claim.sourceType === 'primary') return 5
  if (claim.sourceType === 'independent') return 4
  if (claim.sourceType === 'private') return 3
  if (claim.sourceType === 'local') return 2
  return 1
}

function formatClaimLine(claim: AgenticSearchEvidenceClaim): string {
  const source = claim.url ?? claim.source
  const date = claim.date ? ` date=${claim.date}` : ''
  return `- [${claim.citationId}] type=${claim.sourceType} polarity=${claim.polarity}${date} source=${source} :: ${claim.snippet}`
}

function packMetadata({
  text,
  budgetChars,
  selectedClaims,
  extraction,
}: {
  text: string
  budgetChars: number
  selectedClaims: AgenticSearchEvidenceClaim[]
  extraction: AgenticSearchEvidenceExtraction
}): AgenticSearchEvidencePackMetadata {
  return {
    packChars: text.length,
    budgetChars,
    citationCount: selectedClaims.length,
    truncatedClaimCount: Math.max(
      0,
      extraction.claims.length - selectedClaims.length,
    ),
    primaryClaimCount: selectedClaims.filter(
      claim => claim.sourceType === 'primary',
    ).length,
    independentClaimCount: selectedClaims.filter(
      claim => claim.sourceType === 'independent',
    ).length,
    conflictCount: extraction.conflictGroups.length,
    crossCheckCoverage: extraction.summary.crossCheckCoverage,
    estimatedInputTokens: Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE),
    estimatedCostUsd: roundCurrency(
      (Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE) / 1_000_000) *
        ESTIMATED_INPUT_COST_PER_MILLION_TOKENS_USD,
    ),
    citationCompressionRatio: roundMetric(
      selectedClaims.length / Math.max(1, extraction.claims.length),
    ),
    recommendedInjectionTarget: 'context_packer',
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
