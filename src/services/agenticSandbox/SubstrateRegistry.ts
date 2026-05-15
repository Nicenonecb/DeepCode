import { DockerAgenticSandboxSubstrate } from './DockerSubstrate.js'
import { LocalAgenticSandboxSubstrate } from './LocalSubstrate.js'
import type {
  AgenticSandboxFallbackPolicy,
  AgenticSandboxRequest,
  AgenticSandboxSubstrate,
  AgenticSandboxSubstrateKind,
} from './types.js'
import { UnavailableAgenticSandboxSubstrate } from './UnavailableSubstrate.js'

export type AgenticSandboxSubstrateRegistry = Partial<
  Record<AgenticSandboxSubstrateKind, AgenticSandboxSubstrate>
>

export type ResolveAgenticSandboxSubstrateResult = {
  substrate: AgenticSandboxSubstrate
  requestedSubstrate: AgenticSandboxSubstrateKind
  fallbackReason?: string
}

export function createDefaultSubstrateRegistry(): AgenticSandboxSubstrateRegistry {
  return {
    local: new LocalAgenticSandboxSubstrate(),
    container: new DockerAgenticSandboxSubstrate(),
    microvm: new UnavailableAgenticSandboxSubstrate(
      'microvm',
      'microVM substrate is not implemented yet.',
    ),
    fullvm: new UnavailableAgenticSandboxSubstrate(
      'fullvm',
      'full VM substrate is not implemented yet.',
    ),
  }
}

export function resolveAgenticSandboxSubstrate(
  request: AgenticSandboxRequest,
  registry: AgenticSandboxSubstrateRegistry = createDefaultSubstrateRegistry(),
): ResolveAgenticSandboxSubstrateResult {
  const requestedSubstrate = request.substrate ?? 'local'
  const substrate = registry[requestedSubstrate]
  if (substrate) {
    if (
      substrate instanceof UnavailableAgenticSandboxSubstrate &&
      request.fallbackPolicy === 'fallback-to-local' &&
      registry.local
    ) {
      return {
        substrate: registry.local,
        requestedSubstrate,
        fallbackReason: substrate.reason,
      }
    }
    return {
      substrate,
      requestedSubstrate,
    }
  }

  const fallbackPolicy = request.fallbackPolicy ?? defaultFallbackPolicy()
  if (fallbackPolicy === 'fallback-to-local' && registry.local) {
    return {
      substrate: registry.local,
      requestedSubstrate,
      fallbackReason: `Requested substrate "${requestedSubstrate}" is not registered; using local substrate.`,
    }
  }

  throw new Error(
    `Agentic sandbox substrate "${requestedSubstrate}" is not registered.`,
  )
}

export function defaultFallbackPolicy(): AgenticSandboxFallbackPolicy {
  return 'fail'
}
