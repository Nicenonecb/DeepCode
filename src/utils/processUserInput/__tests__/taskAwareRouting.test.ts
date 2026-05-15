import { describe, expect, mock, test } from 'bun:test'
import type { ProcessUserInputContext } from '../processUserInput.js'

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'TASK_AWARE_MODEL_ROUTING',
}))

mock.module('src/services/analytics/index.js', () => ({
  attachAnalyticsSink: () => {},
  logEventAsync: async () => {},
  logEvent: () => {},
  stripProtoFields: <T>(value: T) => value,
  _resetForTesting: () => {},
}))

mock.module('../../telemetry/events.js', () => ({
  logOTelEvent: () => {},
  redactIfDisabled: (value: string) => value,
}))

mock.module('../processBashCommand.js', () => ({
  processBashCommand: async () => ({
    messages: [],
    shouldQuery: true,
  }),
}))

const { applyTaskAwareModelRoute } = await import('../processUserInput.js')
const { parseUserSpecifiedModel } = await import('../../model/model.js')
const { DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG } = await import(
  '../../taskAwareModelRouter.js'
)

function makeContext({
  mainLoopModel = null,
  mainLoopModelForSession = null,
  effortValue,
}: {
  mainLoopModel?: string | null
  mainLoopModelForSession?: string | null
  effortValue?: string
} = {}): ProcessUserInputContext {
  return {
    getAppState: () => ({
      mainLoopModel,
      mainLoopModelForSession,
      effortValue,
      sessionHooks: new Map(),
      toolPermissionContext: {
        mode: 'default',
      },
    }),
    options: {
      commands: [],
      isNonInteractiveSession: false,
    },
  } as unknown as ProcessUserInputContext
}

describe('processUserInput task-aware routing', () => {
  test('routes regular explanation prompts to resolved Flash model and low effort', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '解释一下这个模块',
      makeContext(),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBe(parseUserSpecifiedModel('haiku'))
    expect(result.effort).toBe('low')
  })

  test('preserves explicit model and only patches effort', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '解释一下这个模块',
      makeContext({ mainLoopModel: parseUserSpecifiedModel('sonnet') }),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBeUndefined()
    expect(result.effort).toBe('low')
  })

  test('preserves explicit effort and only patches model', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '修复登录失败的问题',
      makeContext({ effortValue: 'medium' }),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBe(parseUserSpecifiedModel('opus'))
    expect(result.effort).toBeUndefined()
  })

  test('does not patch unrelated prompts', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '继续',
      makeContext(),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBeUndefined()
    expect(result.effort).toBeUndefined()
  })
})
