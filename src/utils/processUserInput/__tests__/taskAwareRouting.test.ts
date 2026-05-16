import { describe, expect, mock, test } from 'bun:test'
import type { ProcessUserInputContext } from '../processUserInput.js'

mock.module('bun:bundle', () => ({
  feature: () => false,
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
const { processUserInput } = await import('../processUserInput.js')
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
  test('applies stable routing from processUserInput without the experiment feature flag', async () => {
    const savedOpenAIEnv = process.env.CLAUDE_CODE_USE_OPENAI
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    try {
      const result = await processUserInput({
        input: '解释一下这个模块',
        mode: 'prompt',
        setToolJSX: () => {},
        context: makeContext(),
        messages: [],
        uuid: 'task-aware-routing-test',
        querySource: 'cli',
      })

      expect(result.model).toBe(parseUserSpecifiedModel('haiku'))
      expect(result.effort).toBe('low')
      expect(result.thinkingConfig).toEqual({ type: 'disabled' })
    } finally {
      if (savedOpenAIEnv === undefined) {
        delete process.env.CLAUDE_CODE_USE_OPENAI
      } else {
        process.env.CLAUDE_CODE_USE_OPENAI = savedOpenAIEnv
      }
    }
  })

  test('routes regular explanation prompts to resolved Flash model and low effort', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '解释一下这个模块',
      makeContext(),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBe(parseUserSpecifiedModel('haiku'))
    expect(result.effort).toBe('low')
    expect(result.thinkingConfig).toEqual({ type: 'disabled' })
  })

  test('preserves explicit session model and only patches effort', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '解释一下这个模块',
      makeContext({
        mainLoopModelForSession: parseUserSpecifiedModel('sonnet'),
      }),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBeUndefined()
    expect(result.effort).toBe('low')
  })

  test('preserves explicit configured model and only patches effort', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '修复登录失败的问题',
      makeContext({ mainLoopModel: parseUserSpecifiedModel('sonnet') }),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBeUndefined()
    expect(result.effort).toBe('high')
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

  test('preserves command-provided model and effort together', async () => {
    const result = applyTaskAwareModelRoute(
      {
        messages: [],
        shouldQuery: true,
        model: parseUserSpecifiedModel('sonnet'),
        effort: 'medium',
      },
      '做一次复杂 migration',
      makeContext(),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBe(parseUserSpecifiedModel('sonnet'))
    expect(result.effort).toBe('medium')
  })

  test('does not patch unrelated prompts', async () => {
    const result = applyTaskAwareModelRoute(
      { messages: [], shouldQuery: true },
      '随便弄一下',
      makeContext(),
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )

    expect(result.model).toBeUndefined()
    expect(result.effort).toBeUndefined()
  })
})
