import { describe, expect, test } from 'bun:test'
import { getTaskAwareModelRoutingConfig } from '../taskAwareModelRoutingConfig.js'
import { DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG } from '../taskAwareModelRouter.js'

describe('getTaskAwareModelRoutingConfig', () => {
  test('returns defaults when settings do not configure task-aware routing', () => {
    expect(getTaskAwareModelRoutingConfig({})).toEqual(
      DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
    )
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
      enabled: true,
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
})
