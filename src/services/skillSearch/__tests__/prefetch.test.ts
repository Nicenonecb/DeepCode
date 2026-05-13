import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearCommandsCache } from '../../../commands.js'
import {
  clearSkillDiscoveryStateForTesting,
  getTurnZeroSkillDiscovery,
} from '../prefetch.js'
import { clearSkillIndexCache } from '../localSearch.js'
import { clearIntentNormalizeCache } from '../intentNormalize.js'

let root: string
const envKeys = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SKILL_LEARNING_HOME',
  'SKILL_SEARCH_ENABLED',
  'SKILL_LEARNING_ENABLED',
  'SKILL_SEARCH_INTENT_ENABLED',
  'CLAUDE_CODE_DISABLE_ADVISOR_TOOL',
  'NODE_ENV',
  'ANTHROPIC_API_KEY',
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-search-prefetch-'))
  for (const key of envKeys) {
    savedEnv[key] = process.env[key]
  }
  process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
  process.env.CLAUDE_SKILL_LEARNING_HOME = join(root, 'learning')
  process.env.SKILL_SEARCH_ENABLED = '1'
  process.env.SKILL_LEARNING_ENABLED = '1'
  delete process.env.SKILL_SEARCH_INTENT_ENABLED
  process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = '1'
  process.env.NODE_ENV = 'test'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  clearCommandsCache()
  clearSkillIndexCache()
  clearSkillDiscoveryStateForTesting()
  clearIntentNormalizeCache()
})

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  clearCommandsCache()
  clearSkillIndexCache()
  clearSkillDiscoveryStateForTesting()
  clearIntentNormalizeCache()
  try {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  } catch {
    // Windows can keep transient handles after dynamic command loading.
  }
})

describe('skill search prefetch', () => {
  test('auto-loads high-confidence project skill content', async () => {
    const skillDir = join(root, '.claude', 'skills', 'feature-audit')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: feature-audit',
        'description: Audit feature flags and classify minimal implementations',
        '---',
        '',
        '# Feature Audit',
        '',
        'Use the feature flag audit workflow and classify flags as stub, shell, MVP, or thin-toggle.',
      ].join('\n'),
    )

    const attachment = await getTurnZeroSkillDiscovery(
      'audit feature flags for minimal implementation stubs',
      [],
      { agentId: undefined, cwd: root } as any,
    )

    expect(attachment?.type).toBe('skill_discovery')
    if (attachment?.type !== 'skill_discovery') {
      throw new Error('expected skill_discovery attachment')
    }
    expect(attachment.skills[0]?.name).toBe('feature-audit')
    expect(attachment.skills[0]?.autoLoaded).toBe(true)
    expect(attachment.skills[0]?.content).toContain(
      'feature flag audit workflow',
    )
  })

  test('records a pending skill gap on the first unmatched prompt (no draft file yet)', async () => {
    const attachment = await getTurnZeroSkillDiscovery(
      'frobnicate zephyr ledger workflow',
      [],
      { agentId: undefined, cwd: root } as any,
    )

    expect(attachment?.type).toBe('skill_discovery')
    if (attachment?.type !== 'skill_discovery') {
      throw new Error('expected skill_discovery attachment')
    }
    expect(attachment.skills).toEqual([])
    expect(attachment.gap?.status).toBe('pending')
    expect(attachment.gap?.draftPath).toBeUndefined()
  })
})
