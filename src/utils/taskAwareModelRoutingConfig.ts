import type { EffortLevel } from './effort.js'
import { isEffortLevel } from './effort.js'
import { getInitialSettings } from './settings/settings.js'
import {
  DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG,
  TASK_AWARE_ROUTE_KINDS,
  type TaskAwareModelRouteTarget,
  type TaskAwareModelRoutingConfig,
  type TaskAwareRouteKind,
} from './taskAwareModelRouter.js'

type TaskAwareRoutingSettings = {
  taskAwareModelRouting?: {
    enabled?: boolean
    routes?: Partial<
      Record<
        TaskAwareRouteKind,
        Partial<{
          model: string
          effort: EffortLevel
        }>
      >
    >
  }
}

export function getTaskAwareModelRoutingConfig(
  settings: TaskAwareRoutingSettings = getInitialSettings(),
): TaskAwareModelRoutingConfig {
  const raw = settings.taskAwareModelRouting
  if (!raw) return DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG

  return {
    enabled: raw.enabled ?? DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.enabled,
    routes: TASK_AWARE_ROUTE_KINDS.reduce(
      (routes, kind) => {
        routes[kind] = resolveRoute(kind, raw.routes?.[kind])
        return routes
      },
      {} as Record<TaskAwareRouteKind, TaskAwareModelRouteTarget>,
    ),
  }
}

function resolveRoute(
  kind: TaskAwareRouteKind,
  override: Partial<TaskAwareModelRouteTarget> | undefined,
): TaskAwareModelRouteTarget {
  const fallback = DEFAULT_TASK_AWARE_MODEL_ROUTING_CONFIG.routes[kind]
  return {
    model: sanitizeModel(override?.model) ?? fallback.model,
    effort: sanitizeEffort(override?.effort) ?? fallback.effort,
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
