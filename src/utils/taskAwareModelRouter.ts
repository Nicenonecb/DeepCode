import type { EffortLevel } from './effort.js'

export type TaskAwareRouteKind = 'explain' | 'bugfix' | 'complex'

export type TaskAwareModelRoute = {
  kind: TaskAwareRouteKind
  model: 'haiku' | 'opus'
  effort: EffortLevel
}

export type TaskAwareModelRoutePatch = {
  route: TaskAwareModelRoute
  model?: TaskAwareModelRoute['model']
  effort?: TaskAwareModelRoute['effort']
}

const EXPLAIN_ROUTE: TaskAwareModelRoute = {
  kind: 'explain',
  model: 'haiku',
  effort: 'low',
}

const BUGFIX_ROUTE: TaskAwareModelRoute = {
  kind: 'bugfix',
  model: 'opus',
  effort: 'high',
}

const COMPLEX_ROUTE: TaskAwareModelRoute = {
  kind: 'complex',
  model: 'opus',
  effort: 'max',
}

const COMPLEX_PATTERNS = [
  /疑难/,
  /复杂/,
  /大范围/,
  /大规模/,
  /重构/,
  /架构/,
  /迁移/,
  /重新设计/,
  /系统性/,
  /跨模块/,
  /\b(refactor|restructure|rewrite|redesign|re-architect|architecture|migration|migrate|overhaul)\b/,
  /\b(large|major|complex|hard|deep|systemic)\b.{0,40}\b(change|refactor|rewrite|migration|fix)\b/,
]

const BUGFIX_PATTERNS = [
  /修复/,
  /修一下/,
  /修好/,
  /解决.*(问题|错误|失败|报错|bug)/,
  /(报错|错误|失败|崩溃|异常|不工作|不能用|挂了|回归)/,
  /\b(fix|bugfix|debug|repair|resolve|address)\b/,
  /\b(error|failing|failed|failure|crash|exception|regression|broken|doesn'?t work)\b/,
]

const EXPLAIN_PATTERNS = [
  /解释/,
  /说明/,
  /讲讲/,
  /问答/,
  /是什么/,
  /为什么/,
  /怎么回事/,
  /如何理解/,
  /帮我看懂/,
  /\?$/,
  /？$/,
  /\b(explain|what is|what are|why|how does|how do|summari[sz]e|describe|walk me through)\b/,
]

export function classifyTaskAwareModelRoute(
  input: string | null | undefined,
): TaskAwareModelRoute | undefined {
  const text = normalizeInput(input)
  if (!text) return undefined

  if (matchesAny(text, COMPLEX_PATTERNS)) {
    return COMPLEX_ROUTE
  }

  if (matchesAny(text, BUGFIX_PATTERNS)) {
    return BUGFIX_ROUTE
  }

  if (matchesAny(text, EXPLAIN_PATTERNS)) {
    return EXPLAIN_ROUTE
  }

  return undefined
}

export function getTaskAwareModelRoutePatch({
  input,
  hasModelOverride,
  hasEffortOverride,
}: {
  input: string | null | undefined
  hasModelOverride: boolean
  hasEffortOverride: boolean
}): TaskAwareModelRoutePatch | undefined {
  const route = classifyTaskAwareModelRoute(input)
  if (!route) return undefined

  const patch: TaskAwareModelRoutePatch = { route }
  if (!hasModelOverride) {
    patch.model = route.model
  }
  if (!hasEffortOverride) {
    patch.effort = route.effort
  }

  return patch.model || patch.effort ? patch : undefined
}

function normalizeInput(input: string | null | undefined): string {
  return (input ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}
