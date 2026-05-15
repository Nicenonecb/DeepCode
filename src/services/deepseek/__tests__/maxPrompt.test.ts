import { describe, expect, test } from 'bun:test'
import { createUserMessage } from '../../../utils/messages.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import { applyDeepSeekMaxPromptPatch } from '../maxPrompt.js'
import { resolveDeepSeekEffortProfile } from '../modelProfiles.js'

describe('applyDeepSeekMaxPromptPatch', () => {
  test('injects the Max prompt only for DeepSeek V4 Pro max thinking', () => {
    const result = applyDeepSeekMaxPromptPatch({
      model: 'deepseek-v4-pro',
      effortProfile: resolveDeepSeekEffortProfile('deepseek-v4-pro', 'max'),
      enableThinking: true,
      systemPrompt: asSystemPrompt(['base']),
      messages: [createUserMessage({ content: 'fix this bug' })],
    })

    expect(result.injected).toBe(true)
    expect(result.conflictPolicy).toBe('none')
    expect(result.systemPrompt).toHaveLength(2)
    expect(result.systemPrompt[1]).toContain('pressure-test assumptions')
  })

  test('does not inject for high, non-think, non-V4-Pro, or disabled thinking', () => {
    const base = {
      systemPrompt: asSystemPrompt(['base']),
      messages: [createUserMessage({ content: 'fix this bug' })],
    }

    expect(
      applyDeepSeekMaxPromptPatch({
        ...base,
        model: 'deepseek-v4-pro',
        effortProfile: resolveDeepSeekEffortProfile('deepseek-v4-pro', 'high'),
        enableThinking: true,
      }).injected,
    ).toBe(false)
    expect(
      applyDeepSeekMaxPromptPatch({
        ...base,
        model: 'deepseek-v4-pro',
        effortProfile: resolveDeepSeekEffortProfile('deepseek-v4-pro', 'low'),
        enableThinking: false,
      }).injected,
    ).toBe(false)
    expect(
      applyDeepSeekMaxPromptPatch({
        ...base,
        model: 'deepseek-v3.2',
        effortProfile: resolveDeepSeekEffortProfile('deepseek-v3.2', 'max'),
        enableThinking: true,
      }).injected,
    ).toBe(false)
  })

  test('uses a concise-output conflict policy when the user asks for brevity', () => {
    const result = applyDeepSeekMaxPromptPatch({
      model: 'deepseek-v4-pro',
      effortProfile: resolveDeepSeekEffortProfile('deepseek-v4-pro', 'max'),
      enableThinking: true,
      systemPrompt: asSystemPrompt(['base']),
      messages: [createUserMessage({ content: '简洁回答，只给结论' })],
    })

    expect(result.injected).toBe(true)
    expect(result.conflictPolicy).toBe('concise-output')
    expect(result.systemPrompt[1]).toContain('final response short')
  })
})
