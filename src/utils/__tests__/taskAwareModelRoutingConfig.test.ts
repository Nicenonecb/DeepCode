import { afterEach, describe, expect, test } from 'bun:test'
import { getTaskAwareModelRoutingConfig } from '../taskAwareModelRoutingConfig.js'
import { DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG } from '../taskAwareModelRouter.js'

describe('getTaskAwareModelRoutingConfig', () => {
  const savedDisableEnv =
    process.env.CLAUDE_CODE_DISABLE_TASK_AWARE_MODEL_ROUTING

  afterEach(() => {
    if (savedDisableEnv === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_TASK_AWARE_MODEL_ROUTING
    } else {
      process.env.CLAUDE_CODE_DISABLE_TASK_AWARE_MODEL_ROUTING = savedDisableEnv
    }
  })

  test('enables stable routing by default for OpenAI-compatible providers', () => {
    expect(getTaskAwareModelRoutingConfig({ modelType: 'openai' })).toEqual({
      ...DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
      enabled: true,
    })
  })

  test('keeps routing off by default for first-party settings', () => {
    expect(getTaskAwareModelRoutingConfig({})).toEqual({
      ...DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
      enabled: false,
    })
  })

  test('merges configured route targets with defaults', () => {
    expect(
      getTaskAwareModelRoutingConfig({
        taskAwareModelRouting: {
          routes: {
            explain: {
              model: 'deepseek-v4-flash',
              effort: 'medium',
              thinking: 'enabled',
            },
            complex: { effort: 'high' },
          },
        },
      }),
    ).toEqual({
      enabled: false,
      routes: {
        explain: {
          model: 'deepseek-v4-flash',
          effort: 'medium',
          thinking: 'enabled',
        },
        bugfix: DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes.bugfix,
        complex: {
          model: DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes.complex.model,
          effort: 'high',
          thinking:
            DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes.complex.thinking,
        },
      },
    })
  })

  test('honors explicit settings enablement outside OpenAI-compatible providers', () => {
    expect(
      getTaskAwareModelRoutingConfig({
        taskAwareModelRouting: { enabled: true },
      }),
    ).toEqual({
      enabled: true,
      routes: DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes,
    })
  })

  test('preserves disabled setting and ignores invalid route values', () => {
    expect(
      getTaskAwareModelRoutingConfig({
        taskAwareModelRouting: {
          enabled: false,
          routes: {
            bugfix: { model: '  ', effort: 'invalid' as 'high' },
          },
        },
      }),
    ).toEqual({
      enabled: false,
      routes: DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes,
    })
  })

  test('environment disable switch wins over provider defaults', () => {
    process.env.CLAUDE_CODE_DISABLE_TASK_AWARE_MODEL_ROUTING = '1'

    expect(getTaskAwareModelRoutingConfig({ modelType: 'openai' })).toEqual({
      enabled: false,
      routes: DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes,
    })
  })
})
