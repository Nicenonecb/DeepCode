import { describe, expect, test } from 'bun:test'
import {
  buildContextWatermarkSnapshot,
  getLatestContextWatermarkSnapshot,
  setLatestContextWatermarkSnapshot,
} from '../ContextWatermark.js'
import type { ContextPack } from '../ContextPacker.js'

describe('ContextWatermark', () => {
  test('builds a compact snapshot from pack sections and runtime budget', () => {
    const snapshot = buildContextWatermarkSnapshot({
      pack: contextPack(),
      runtimeBudget: {
        maxContextTokens: 800_000,
        contextWatermark: 0.8,
        source: 'deepseek-v4-pro:max',
      },
      triggerReason: 'deepseek-v4-pro-max',
      agentContextCapTokens: 512_000,
    })

    expect(snapshot).toEqual({
      generatedAt: 123,
      source: 'deepseek-v4-pro:max',
      triggerReason: 'deepseek-v4-pro-max',
      contextWatermark: 0.8,
      maxContextTokens: 800_000,
      packBudgetChars: 2_560_000,
      packChars: 1_280_000,
      packUsagePercent: 50,
      sectionCount: 3,
      truncatedSectionCount: 1,
      hotSectionCount: 1,
      warmSectionCount: 1,
      coldSectionCount: 1,
      agentContextCapTokens: 512_000,
      agentContextCapHit: true,
    })
  })

  test('stores and clears the latest snapshot for status line display', () => {
    const snapshot = buildContextWatermarkSnapshot({ pack: contextPack() })

    setLatestContextWatermarkSnapshot(snapshot)
    expect(getLatestContextWatermarkSnapshot()).toBe(snapshot)

    setLatestContextWatermarkSnapshot(null)
    expect(getLatestContextWatermarkSnapshot()).toBeNull()
  })
})

function contextPack(): ContextPack {
  return {
    cwd: '/repo',
    generatedAt: 123,
    maxChars: 2_560_000,
    totalChars: 1_280_000,
    truncated: true,
    sections: [
      {
        id: 'task',
        title: 'Task',
        tier: 'hot',
        priority: 100,
        content: 'Fix it',
        charCount: 100,
        truncated: false,
      },
      {
        id: 'related_files',
        title: 'Related Files',
        tier: 'warm',
        priority: 80,
        content: 'src/a.ts',
        charCount: 200,
        truncated: true,
      },
      {
        id: 'repo_map',
        title: 'Repo Map',
        tier: 'cold',
        priority: 10,
        content: 'src',
        charCount: 300,
        truncated: false,
      },
    ],
  }
}
