import type { ContextPack, ContextPackRuntimeBudget } from './ContextPacker.js'

export type ContextWatermarkSnapshot = {
  generatedAt: number
  source: string
  contextWatermark?: number
  maxContextTokens?: number
  packBudgetChars: number
  packChars: number
  packUsagePercent: number
  sectionCount: number
  truncatedSectionCount: number
  hotSectionCount: number
  warmSectionCount: number
  coldSectionCount: number
  agentContextCapTokens?: number
  agentContextCapHit: boolean
}

let latestContextWatermarkSnapshot: ContextWatermarkSnapshot | null = null

export function buildContextWatermarkSnapshot(params: {
  pack: ContextPack
  runtimeBudget?: ContextPackRuntimeBudget
  agentContextCapTokens?: number
}): ContextWatermarkSnapshot {
  const { pack, runtimeBudget, agentContextCapTokens } = params
  const packUsagePercent =
    pack.maxChars > 0 ? Math.round((pack.totalChars / pack.maxChars) * 100) : 0

  return {
    generatedAt: pack.generatedAt,
    source: runtimeBudget?.source ?? 'settings',
    ...(runtimeBudget?.contextWatermark === undefined
      ? {}
      : { contextWatermark: runtimeBudget.contextWatermark }),
    ...(runtimeBudget?.maxContextTokens === undefined
      ? {}
      : { maxContextTokens: runtimeBudget.maxContextTokens }),
    packBudgetChars: pack.maxChars,
    packChars: pack.totalChars,
    packUsagePercent,
    sectionCount: pack.sections.length,
    truncatedSectionCount: pack.sections.filter(section => section.truncated)
      .length,
    hotSectionCount: pack.sections.filter(section => section.tier === 'hot')
      .length,
    warmSectionCount: pack.sections.filter(section => section.tier === 'warm')
      .length,
    coldSectionCount: pack.sections.filter(section => section.tier === 'cold')
      .length,
    ...(agentContextCapTokens === undefined ? {} : { agentContextCapTokens }),
    agentContextCapHit: agentContextCapTokens !== undefined,
  }
}

export function setLatestContextWatermarkSnapshot(
  snapshot: ContextWatermarkSnapshot | null,
): void {
  latestContextWatermarkSnapshot = snapshot
}

export function getLatestContextWatermarkSnapshot(): ContextWatermarkSnapshot | null {
  return latestContextWatermarkSnapshot
}
