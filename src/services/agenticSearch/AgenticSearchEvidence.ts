import type {
  AgenticSearchConflictGroup,
  AgenticSearchCrossCheckSummary,
  AgenticSearchEvidenceClaim,
  AgenticSearchEvidenceExtraction,
  AgenticSearchFetchedEvidence,
  AgenticSearchSourceType,
} from './types.js'

const MAX_SNIPPET_CHARS = 360
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?。！？])\s+|\n+/
const DATE_PATTERN =
  /\b(20\d{2}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])|20\d{2})\b/
const CONTRADICTION_PATTERN =
  /\b(not|no longer|deprecated|removed|unsupported|failed|cannot|never|false)\b|不支持|失败|不能|不会|移除|废弃/
const SUPPORT_PATTERN =
  /\b(supports?|available|enabled|works?|passed|can|true|official|default)\b|支持|通过|可以|默认|官方|可用/

export function extractAgenticSearchEvidence(
  evidence: AgenticSearchFetchedEvidence[],
): AgenticSearchEvidenceExtraction {
  const claims = evidence.flatMap((item, evidenceIndex) =>
    extractClaimsFromEvidence(item, evidenceIndex),
  )
  const conflictGroups = buildConflictGroups(claims)
  const summary = summarizeCrossCheck(claims, conflictGroups)

  return { claims, conflictGroups, summary }
}

export function summarizeCrossCheck(
  claims: AgenticSearchEvidenceClaim[],
  conflictGroups: AgenticSearchConflictGroup[],
): AgenticSearchCrossCheckSummary {
  const primaryClaimCount = claims.filter(
    claim => claim.sourceType === 'primary',
  ).length
  const independentClaimCount = claims.filter(
    claim => claim.sourceType === 'independent',
  ).length
  const localClaimCount = claims.filter(
    claim => claim.sourceType === 'local',
  ).length
  const privateClaimCount = claims.filter(
    claim => claim.sourceType === 'private',
  ).length
  const claimCount = claims.length

  return {
    claimCount,
    primaryClaimCount,
    independentClaimCount,
    localClaimCount,
    privateClaimCount,
    conflictCount: conflictGroups.length,
    hasPrimarySupport: primaryClaimCount > 0,
    hasIndependentCrossCheck: independentClaimCount > 0,
    crossCheckCoverage:
      claimCount === 0
        ? 0
        : roundMetric((primaryClaimCount + independentClaimCount) / claimCount),
  }
}

function extractClaimsFromEvidence(
  evidence: AgenticSearchFetchedEvidence,
  evidenceIndex: number,
): AgenticSearchEvidenceClaim[] {
  const sourceType = classifySourceType(evidence)
  const date = extractDate([evidence.title, evidence.url, evidence.content])
  const sentences = evidence.content
    .split(SENTENCE_SPLIT_PATTERN)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .slice(0, 4)

  const claimSentences = sentences.length > 0 ? sentences : [evidence.content]

  return claimSentences.map((sentence, index) => {
    const polarity = classifyPolarity(sentence)
    return {
      id: `claim-${evidenceIndex + 1}-${index + 1}`,
      evidenceIndex,
      source: evidence.source,
      sourceType,
      ...(evidence.title ? { title: evidence.title } : {}),
      ...(evidence.url ? { url: evidence.url } : {}),
      ...(date ? { date } : {}),
      claim: normalizeWhitespace(sentence),
      snippet: snippet(sentence),
      polarity,
      supportStrength: supportStrength(sourceType, polarity),
      citationId: `A${evidenceIndex + 1}.${index + 1}`,
    }
  })
}

function classifySourceType(
  evidence: AgenticSearchFetchedEvidence,
): AgenticSearchSourceType {
  if (evidence.source === 'local_search' || evidence.source === 'bash_search') {
    return 'local'
  }
  if (evidence.source === 'mcp_search') {
    return 'private'
  }
  if (!evidence.url) {
    return 'unknown'
  }

  try {
    const host = new URL(evidence.url).hostname.toLowerCase()
    if (
      host.includes('docs.') ||
      host.includes('developer.') ||
      host.includes('api.') ||
      host.includes('github.com') ||
      host.includes('deepseek.com') ||
      host.includes('openai.com')
    ) {
      return 'primary'
    }
    return 'independent'
  } catch {
    return 'unknown'
  }
}

function classifyPolarity(
  text: string,
): AgenticSearchEvidenceClaim['polarity'] {
  if (CONTRADICTION_PATTERN.test(text)) {
    return 'contradicts'
  }
  if (SUPPORT_PATTERN.test(text)) {
    return 'supports'
  }
  return 'neutral'
}

function supportStrength(
  sourceType: AgenticSearchSourceType,
  polarity: AgenticSearchEvidenceClaim['polarity'],
): number {
  const sourceScore =
    sourceType === 'primary'
      ? 0.95
      : sourceType === 'independent'
        ? 0.8
        : sourceType === 'private' || sourceType === 'local'
          ? 0.7
          : 0.45
  const polarityPenalty = polarity === 'neutral' ? 0.15 : 0
  return roundMetric(Math.max(0, sourceScore - polarityPenalty))
}

function buildConflictGroups(
  claims: AgenticSearchEvidenceClaim[],
): AgenticSearchConflictGroup[] {
  const byTopic = new Map<string, AgenticSearchEvidenceClaim[]>()

  for (const claim of claims) {
    const topic = topicKey(claim.claim)
    const bucket = byTopic.get(topic) ?? []
    bucket.push(claim)
    byTopic.set(topic, bucket)
  }

  const groups: AgenticSearchConflictGroup[] = []
  for (const [topic, topicClaims] of byTopic) {
    const polarities = [...new Set(topicClaims.map(claim => claim.polarity))]
    if (polarities.includes('supports') && polarities.includes('contradicts')) {
      groups.push({
        id: `conflict-${groups.length + 1}`,
        topic,
        claimIds: topicClaims.map(claim => claim.id),
        polarities,
      })
    }
  }

  return groups
}

function topicKey(claim: string): string {
  const words = normalizeWhitespace(claim)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(
      word =>
        ![
          'the',
          'and',
          'that',
          'this',
          'with',
          'from',
          'not',
          'does',
          'cannot',
          'true',
          'false',
        ].includes(word),
    )
    .map(word => (word === 'supports' ? 'support' : word))
    .sort()
    .slice(0, 6)
  return words.join(' ') || normalizeWhitespace(claim).slice(0, 40)
}

function extractDate(values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const match = value?.match(DATE_PATTERN)
    if (match?.[1]) {
      return match[1].replaceAll('/', '-')
    }
  }
  return undefined
}

function snippet(value: string): string {
  const normalized = normalizeWhitespace(value)
  return normalized.length <= MAX_SNIPPET_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_SNIPPET_CHARS - 3)}...`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
