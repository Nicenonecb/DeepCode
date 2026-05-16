import type { EffortLevel } from './effort.js'
import { isEnvTruthy } from './envUtils.js'
import { isEffortLevel } from './effort.js'
import { getAPIProvider } from './model/providers.js'
import { getInitialSettings } from './settings/settings.js'
import {
  DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
  TASK_AWARE_ROUTE_KINDS,
  type TaskAwareModelRouteTarget,
  type TaskAwareModelRoutingConfig,
  type TaskAwareRouteKind,
} from './taskAwareModelRouter.js'

type TaskAwareRoutingSettings = {
  modelType?: 'anthropic' | 'openai' | 'gemini' | 'grok'
  taskAwareModelRouting?: {
    enabled?: boolean
    routes?: Partial<
      Record<
        TaskAwareRouteKind,
        Partial<{
          model: string
          effort: EffortLevel
          thinking: 'enabled' | 'disabled'
        }>
      >
    >
  }
}

export function getTaskAwareModelRoutingConfig(
  settings: TaskAwareRoutingSettings = getInitialSettings(),
): TaskAwareModelRoutingConfig {
  const raw = settings.taskAwareModelRouting
  if (!raw) {
    return {
      ...DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
      enabled: shouldEnableTaskAwareModelRouting(settings),
    }
  }

  return {
    enabled: raw.enabled ?? shouldEnableTaskAwareModelRouting(settings),
    routes: TASK_AWARE_ROUTE_KINDS.reduce(
      (routes, kind) => {
        routes[kind] = resolveRoute(kind, raw.routes?.[kind])
        return routes
      },
      {} as Record<TaskAwareRouteKind, TaskAwareModelRouteTarget>,
    ),
  }
}

export function shouldEnableTaskAwareModelRouting(
  settings: TaskAwareRoutingSettings = getInitialSettings(),
): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TASK_AWARE_MODEL_ROUTING)) {
    return false
  }

  if (settings.taskAwareModelRouting?.enabled !== undefined) {
    return settings.taskAwareModelRouting.enabled
  }

  return getAPIProvider(settings) === 'openai'
}

function resolveRoute(
  kind: TaskAwareRouteKind,
  override: Partial<TaskAwareModelRouteTarget> | undefined,
): TaskAwareModelRouteTarget {
  const fallback = DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes[kind]
  return {
    model: sanitizeModel(override?.model) ?? fallback.model,
    effort: sanitizeEffort(override?.effort) ?? fallback.effort,
    thinking: sanitizeThinking(override?.thinking) ?? fallback.thinking,
  }
}

function sanitizeModel(model: unknown): string | undefined {
  return typeof model === 'string' && model.trim() ? model.trim() : undefined
}

function sanitizeEffort(effort: unknown): EffortLevel | undefined {
  return typeof effort === 'string' && isEffortLevel(effort)
    ? effort
    : undefined
}

function sanitizeThinking(
  thinking: unknown,
): 'enabled' | 'disabled' | undefined {
  return thinking === 'enabled' || thinking === 'disabled'
    ? thinking
    : undefined
}
