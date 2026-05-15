import { resolve } from 'node:path'
import {
  LocalAgenticSandboxSubstrate,
  normalizeResourceLimits,
} from './LocalSubstrate.js'
import type {
  AgenticSandboxCommand,
  AgenticSandboxCommandResult,
  AgenticSandboxPrepareResult,
  AgenticSandboxRequest,
  AgenticSandboxSubstrate,
} from './types.js'

const DEFAULT_DOCKER_IMAGE = 'oven/bun:1'
const WORKSPACE_MOUNT = '/workspace'

export class DockerAgenticSandboxSubstrate implements AgenticSandboxSubstrate {
  readonly kind = 'container'

  constructor(
    private readonly localRunner = new LocalAgenticSandboxSubstrate(),
  ) {}

  async prepare(
    request: AgenticSandboxRequest,
  ): Promise<AgenticSandboxPrepareResult> {
    const resourceLimits = normalizeResourceLimits(request.resourceLimits)
    const cache = {
      image: request.cache?.image ?? DEFAULT_DOCKER_IMAGE,
      ...(request.cache?.cacheKey ? { cacheKey: request.cache.cacheKey } : {}),
      ...(request.cache?.warm !== undefined
        ? { warm: request.cache.warm }
        : {}),
      ...(request.cache?.warmCommands
        ? { warmCommands: request.cache.warmCommands }
        : {}),
    }
    if (cache.warm === true) {
      await this.warmCache(request.cwd, cache.image, cache.warmCommands ?? [])
    }

    return {
      substrate: 'container',
      cwd: request.cwd,
      traceDir: request.traceDir ?? request.cwd,
      cacheSpec: cache,
      resourceLimits,
    }
  }

  async runCommand(
    command: AgenticSandboxCommand,
    context: AgenticSandboxPrepareResult,
    signal?: AbortSignal,
  ): Promise<AgenticSandboxCommandResult> {
    const dockerArgs = buildDockerRunArgs(command, context)
    return this.localRunner.runCommand(
      {
        id: command.id,
        command: 'docker',
        args: dockerArgs,
        cwd: context.cwd,
        timeoutMs: command.timeoutMs ?? context.resourceLimits.timeoutMs,
        env: command.env,
        description: command.description,
      },
      {
        ...context,
        substrate: 'local',
      },
      signal,
    )
  }

  private async warmCache(
    cwd: string,
    image: string,
    warmCommands: string[],
  ): Promise<void> {
    await this.localRunner.runCommand(
      {
        command: 'docker',
        args: ['pull', image],
        cwd,
        description: `Prewarm ${image}`,
      },
      {
        substrate: 'local',
        cwd,
        traceDir: cwd,
        resourceLimits: normalizeResourceLimits(),
      },
    )

    for (const warmCommand of warmCommands) {
      await this.localRunner.runCommand(
        {
          command: 'docker',
          args: buildDockerRunArgs(
            {
              command: 'sh',
              args: ['-lc', warmCommand],
            },
            {
              substrate: 'container',
              cwd,
              traceDir: cwd,
              cache: {
                image,
                cacheKey: `warm-${image}`,
                keySource: 'explicit',
                warmRequested: false,
                warmCommands: [],
              },
              resourceLimits: normalizeResourceLimits(),
            },
          ),
          cwd,
          description: `Warm container cache: ${warmCommand}`,
        },
        {
          substrate: 'local',
          cwd,
          traceDir: cwd,
          resourceLimits: normalizeResourceLimits(),
        },
      )
    }
  }
}

export function buildDockerRunArgs(
  command: AgenticSandboxCommand,
  context: AgenticSandboxPrepareResult,
): string[] {
  const image = context.cache?.image ?? DEFAULT_DOCKER_IMAGE
  const workspace = resolve(context.cwd)
  const args = [
    'run',
    '--rm',
    '--workdir',
    WORKSPACE_MOUNT,
    '--volume',
    `${workspace}:${WORKSPACE_MOUNT}`,
  ]

  if (context.resourceLimits.network === 'disabled') {
    args.push('--network', 'none')
  } else if (context.resourceLimits.network === 'allowlist') {
    args.push(
      '--env',
      `DEEPCODE_SANDBOX_ALLOWED_HOSTS=${(context.resourceLimits.allowedNetworkHosts ?? []).join(',')}`,
    )
  }
  if (context.resourceLimits.cpuCores !== undefined) {
    args.push('--cpus', String(context.resourceLimits.cpuCores))
  }
  if (context.resourceLimits.memoryMb !== undefined) {
    args.push('--memory', `${context.resourceLimits.memoryMb}m`)
  }
  if (context.resourceLimits.diskMb !== undefined) {
    args.push('--storage-opt', `size=${context.resourceLimits.diskMb}m`)
  }
  for (const [key, value] of Object.entries(command.env ?? {})) {
    args.push('--env', `${key}=${value}`)
  }

  args.push(image, command.command, ...(command.args ?? []))
  return args
}
