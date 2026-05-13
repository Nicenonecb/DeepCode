import { describe, expect, test } from 'bun:test'
import {
  classifyTaskAwareModelRoute,
  getTaskAwareModelRoutePatch,
} from '../taskAwareModelRouter.js'

describe('classifyTaskAwareModelRoute', () => {
  test('routes explanation and Q&A prompts to Flash with low effort', () => {
    expect(classifyTaskAwareModelRoute('解释一下这个模块是怎么工作的')).toEqual(
      {
        kind: 'explain',
        model: 'haiku',
        effort: 'low',
      },
    )

    expect(
      classifyTaskAwareModelRoute('What is this provider mapping?'),
    ).toEqual({
      kind: 'explain',
      model: 'haiku',
      effort: 'low',
    })
  })

  test('routes clear bugfix prompts to Pro with high effort', () => {
    expect(classifyTaskAwareModelRoute('修复登录失败的问题')).toEqual({
      kind: 'bugfix',
      model: 'opus',
      effort: 'high',
    })

    expect(
      classifyTaskAwareModelRoute('Fix the regression in the OpenAI adapter'),
    ).toEqual({
      kind: 'bugfix',
      model: 'opus',
      effort: 'high',
    })
  })

  test('routes complex refactors to Pro with max effort', () => {
    expect(classifyTaskAwareModelRoute('做一次大范围重构，拆掉旧架构')).toEqual(
      {
        kind: 'complex',
        model: 'opus',
        effort: 'max',
      },
    )

    expect(
      classifyTaskAwareModelRoute('We need a complex migration across modules'),
    ).toEqual({
      kind: 'complex',
      model: 'opus',
      effort: 'max',
    })
  })

  test('prefers complex routing when a prompt includes both refactor and fix signals', () => {
    expect(
      classifyTaskAwareModelRoute('修复这个疑难重构里的状态同步问题'),
    ).toEqual({
      kind: 'complex',
      model: 'opus',
      effort: 'max',
    })
  })

  test('does not route unrelated short prompts', () => {
    expect(classifyTaskAwareModelRoute('继续')).toBeUndefined()
  })
})

describe('getTaskAwareModelRoutePatch', () => {
  test('preserves explicit model and effort overrides independently', () => {
    expect(
      getTaskAwareModelRoutePatch({
        input: '解释一下这个模块',
        hasModelOverride: true,
        hasEffortOverride: false,
      }),
    ).toEqual({
      route: { kind: 'explain', model: 'haiku', effort: 'low' },
      effort: 'low',
    })

    expect(
      getTaskAwareModelRoutePatch({
        input: '修复这个 bug',
        hasModelOverride: false,
        hasEffortOverride: true,
      }),
    ).toEqual({
      route: { kind: 'bugfix', model: 'opus', effort: 'high' },
      model: 'opus',
    })
  })

  test('returns no patch when both model and effort are explicit', () => {
    expect(
      getTaskAwareModelRoutePatch({
        input: '做一次大范围重构',
        hasModelOverride: true,
        hasEffortOverride: true,
      }),
    ).toBeUndefined()
  })
})
