import { afterEach, describe, expect, test } from 'bun:test'
import { resolveAgentContextBudget } from '../agentContextBudget.js'

describe('resolveAgentContextBudget', () => {
  const originalEnv = process.env.DEEPSEEK_AGENT_CONTEXT_CAP_TOKENS

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEEPSEEK_AGENT_CONTEXT_CAP_TOKENS
    } else {
      process.env.DEEPSEEK_AGENT_CONTEXT_CAP_TOKENS = originalEnv
    }
  })

  test('caps large DeepSeek V4 Pro agent tasks at 512K', () => {
    expect(
      resolveAgentContextBudget({
        parentModel: 'deepseek-v4-pro',
        agentType: 'general-purpose',
        description: 'large refactor',
        prompt: 'Refactor a complex multi-file subsystem.',
      }),
    ).toMatchObject({
      capTokens: 512_000,
      parentContextTokens: 1_000_000,
      tier: 'large',
      source: 'model-profile',
    })
  })

  test('uses a smaller cap for ordinary DeepSeek V4 Pro agent tasks', () => {
    expect(
      resolveAgentContextBudget({
        parentModel: 'deepseek-v4-pro',
        agentType: 'general-purpose',
        description: 'read file',
        prompt: 'Check a small helper.',
      }),
    ).toMatchObject({
      capTokens: 256_000,
      parentContextTokens: 1_000_000,
      tier: 'standard',
    })
  })

  test('does not cap normal 200K parent sessions', () => {
    expect(
      resolveAgentContextBudget({
        parentModel: 'claude-sonnet-4-20250514',
        description: 'large refactor',
      }),
    ).toBeUndefined()
  })

  test('allows env override for rollout and benchmark tuning', () => {
    process.env.DEEPSEEK_AGENT_CONTEXT_CAP_TOKENS = '128000'

    expect(
      resolveAgentContextBudget({
        parentModel: 'deepseek-v4-pro',
        description: 'large refactor',
      }),
    ).toMatchObject({
      capTokens: 128_000,
      source: 'env',
    })
  })
})
