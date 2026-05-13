import type { EffortLevel } from './effort.js'

export type TaskAwareRouteKind = 'explain' | 'bugfix' | 'complex'

export type TaskAwareModelRouteTarget = {
  model: string
  effort: EffortLevel
}

export type TaskAwareModelRoute = TaskAwareModelRouteTarget & {
  kind: TaskAwareRouteKind
}

export type TaskAwareModelRoutePatch = {
  route: TaskAwareModelRoute
  model?: TaskAwareModelRouteTarget['model']
  effort?: TaskAwareModelRouteTarget['effort']
}

export type TaskAwareModelRoutingConfig = {
  enabled: boolean
  routes: Record<TaskAwareRouteKind, TaskAwareModelRouteTarget>
}

export const DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG: TaskAwareModelRoutingConfig =
  {
    enabled: true,
    routes: {
      explain: {
        model: 'haiku',
        effort: 'low',
      },
      bugfix: {
        model: 'opus',
        effort: 'high',
      },
      complex: {
        model: 'opus',
        effort: 'max',
      },
    },
  }

export const TASK_AWARE_ROUTE_KINDS = [
  'explain',
  'bugfix',
  'complex',
] as const satisfies readonly TaskAwareRouteKind[]

const ROUTE_PRIORITY = [
  'complex',
  'bugfix',
  'explain',
] as const satisfies readonly TaskAwareRouteKind[]

const ROUTE_PATTERNS: Record<TaskAwareRouteKind, RegExp[]> = {
  complex: [
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
  ],
  bugfix: [
    /修复/,
    /修一下/,
    /修好/,
    /解决.*(问题|错误|失败|报错|bug)/,
    /(报错|错误|失败|崩溃|异常|不工作|不能用|挂了|回归)/,
    /\b(fix|bugfix|debug|repair|resolve|address)\b/,
    /\b(error|failing|failed|failure|crash|exception|regression|broken|doesn'?t work)\b/,
  ],
  explain: [
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
  ],
}

export function classifyTaskAwareModelRoute(
  input: string | null | undefined,
  config: TaskAwareModelRoutingConfig = DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
): TaskAwareModelRoute | undefined {
  if (!config.enabled) return undefined

  const text = normalizeInput(input)
  if (!text) return undefined

  for (const kind of ROUTE_PRIORITY) {
    if (matchesAny(text, ROUTE_PATTERNS[kind])) {
      return {
        kind,
        ...config.routes[kind],
      }
    }
  }

  return undefined
}

export function getTaskAwareModelRoutePatch({
  input,
  hasModelOverride,
  hasEffortOverride,
  config = DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
}: {
  input: string | null | undefined
  hasModelOverride: boolean
  hasEffortOverride: boolean
  config?: TaskAwareModelRoutingConfig
}): TaskAwareModelRoutePatch | undefined {
  const route = classifyTaskAwareModelRoute(input, config)
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
