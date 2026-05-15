import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { AgenticSandboxSession } from '../AgenticSandboxSession.js'
import {
  buildDockerRunArgs,
  DockerAgenticSandboxSubstrate,
} from '../DockerSubstrate.js'
import { UnavailableAgenticSandboxSubstrate } from '../UnavailableSubstrate.js'
import { createAgenticSandboxVerificationExecutor } from '../verificationExecutor.js'
import type {
  AgenticSandboxCommand,
  AgenticSandboxCommandResult,
  AgenticSandboxManifest,
  AgenticSandboxPrepareResult,
  AgenticSandboxRequest,
  AgenticSandboxSubstrate,
} from '../types.js'
import type { VerificationCommand } from '../../verification/index.js'

describe('AgenticSandboxSession', () => {
  test('runs a local command and writes a replayable manifest', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-'))
    const traceDir = join(cwd, 'traces')
    await writeFile(
      join(cwd, 'package.json'),
      '{"scripts":{"test":"bun test"}}',
    )

    try {
      const session = new AgenticSandboxSession({
        id: 'sandbox-smoke',
        cwd,
        purpose: 'unit test',
        traceDir,
        resourceLimits: {
          timeoutMs: 1000,
          maxOutputChars: 1000,
        },
        metadata: {
          source: 'test',
        },
      })

      const result = await session.runCommand({
        command: 'bun',
        args: ['--version'],
        description: 'Print Bun version',
      })
      await session.close()

      expect(result.status).toBe('completed')
      expect(result.exitCode).toBe(0)

      const manifest = await readManifest(
        join(traceDir, 'sandbox-smoke.sandbox.json'),
      )
      expect(manifest).toMatchObject({
        version: 1,
        sessionId: 'sandbox-smoke',
        purpose: 'unit test',
        substrate: 'local',
        cwd,
        status: 'completed',
        cache: {
          keySource: 'workspace',
          warmRequested: false,
        },
        metadata: {
          source: 'test',
        },
        summary: {
          commandCount: 1,
          succeeded: 1,
          failed: 0,
          timedOut: 0,
        },
      })
      expect(manifest.commands[0]).toMatchObject({
        command: 'bun',
        args: ['--version'],
        cwd,
        description: 'Print Bun version',
        status: 'completed',
        exitCode: 0,
      })
      expect(manifest.cache?.cacheKey).toMatch(/^workspace-[a-f0-9]{16}$/)
      expect(manifest.recovery?.snapshot?.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'package.json' }),
        ]),
      )
      expect(manifest.recovery?.replay).toMatchObject({
        commandCount: 1,
        manifestPath: join(traceDir, 'sandbox-smoke.sandbox.json'),
      })
      const replay = await readFile(
        manifest.recovery?.replay?.scriptPath ?? '',
        'utf8',
      )
      expect(replay).toContain("'bun' '--version'")
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('returns policy failure when max command limit is exceeded', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-limit-'))

    try {
      const session = new AgenticSandboxSession({
        id: 'sandbox-limit',
        cwd,
        purpose: 'limit test',
        resourceLimits: {
          maxCommands: 1,
        },
      })

      await session.runCommand({ command: 'bun', args: ['--version'] })

      const result = await session.runCommand({
        command: 'bun',
        args: ['--version'],
      })

      expect(result).toMatchObject({
        status: 'failed',
        policyViolation: {
          code: 'max_commands_exceeded',
        },
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('fails closed for local resource limits it cannot enforce', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-policy-'))
    const traceDir = join(cwd, 'traces')

    try {
      const session = new AgenticSandboxSession({
        id: 'sandbox-policy',
        cwd,
        purpose: 'policy test',
        traceDir,
        resourceLimits: {
          cpuCores: 1,
          memoryMb: 256,
          diskMb: 512,
          network: 'disabled',
        },
      })

      const result = await session.runCommand({
        command: 'bun',
        args: ['--version'],
      })
      await session.close()

      expect(result.status).toBe('failed')
      expect(result.policyViolation?.code).toBe(
        'local_resource_limit_unsupported',
      )
      const manifest = await readManifest(
        join(traceDir, 'sandbox-policy.sandbox.json'),
      )
      expect(
        manifest.policyViolations.map(violation => violation.code),
      ).toEqual([
        'local_resource_limit_unsupported',
        'disk_limit_unsupported',
        'network_allowlist_unsupported',
      ])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('uses registered container substrate and records requested substrate', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-container-'))
    const traceDir = join(cwd, 'traces')
    const substrate = new FakeSubstrate('container')

    try {
      const session = new AgenticSandboxSession(
        {
          id: 'sandbox-container',
          cwd,
          purpose: 'container test',
          substrate: 'container',
          traceDir,
        },
        {
          substrates: {
            container: substrate,
          },
        },
      )

      const result = await session.runCommand({
        command: 'bun',
        args: ['--version'],
      })
      await session.close()

      expect(result.status).toBe('completed')
      expect(substrate.commands[0]).toMatchObject({
        command: 'bun',
        args: ['--version'],
      })

      const manifest = await readManifest(
        join(traceDir, 'sandbox-container.sandbox.json'),
      )
      expect(manifest).toMatchObject({
        substrate: 'container',
        requestedSubstrate: 'container',
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('fails unavailable substrates by default', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-unavailable-'))

    try {
      const session = new AgenticSandboxSession(
        {
          id: 'sandbox-microvm',
          cwd,
          purpose: 'microvm test',
          substrate: 'microvm',
        },
        {
          substrates: {
            microvm: new UnavailableAgenticSandboxSubstrate(
              'microvm',
              'microVM test substrate unavailable',
            ),
          },
        },
      )

      await expect(session.prepare()).rejects.toThrow(
        'microVM test substrate unavailable',
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('allows unavailable substrates to fall back to local when requested', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-fallback-'))
    const traceDir = join(cwd, 'traces')

    try {
      const session = new AgenticSandboxSession(
        {
          id: 'sandbox-fallback',
          cwd,
          purpose: 'fallback test',
          substrate: 'fullvm',
          fallbackPolicy: 'fallback-to-local',
          traceDir,
        },
        {
          substrates: {
            fullvm: new UnavailableAgenticSandboxSubstrate(
              'fullvm',
              'full VM test substrate unavailable',
            ),
          },
        },
      )

      const result = await session.runCommand({
        command: 'bun',
        args: ['--version'],
      })
      await session.close()

      expect(result.status).toBe('completed')
      const manifest = await readManifest(
        join(traceDir, 'sandbox-fallback.sandbox.json'),
      )
      expect(manifest).toMatchObject({
        substrate: 'local',
        requestedSubstrate: 'fullvm',
        fallbackReason: 'full VM test substrate unavailable',
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('DockerAgenticSandboxSubstrate', () => {
  test('builds docker run arguments from cache and resource limits', () => {
    expect(
      buildDockerRunArgs(
        {
          command: 'bun',
          args: ['test'],
          env: {
            CI: '1',
          },
        },
        {
          substrate: 'container',
          cwd: '/repo',
          traceDir: '/repo/traces',
          cache: {
            image: 'oven/bun:1.3',
            cacheKey: 'test-cache',
            keySource: 'explicit',
            warmRequested: false,
            warmCommands: [],
          },
          resourceLimits: {
            timeoutMs: 1000,
            maxOutputChars: 2000,
            cpuCores: 2,
            memoryMb: 512,
            diskMb: 1024,
            network: 'allowlist',
            allowedNetworkHosts: ['registry.npmjs.org'],
          },
        },
      ),
    ).toEqual([
      'run',
      '--rm',
      '--workdir',
      '/workspace',
      '--volume',
      '/repo:/workspace',
      '--env',
      'DEEPCODE_SANDBOX_ALLOWED_HOSTS=registry.npmjs.org',
      '--cpus',
      '2',
      '--memory',
      '512m',
      '--storage-opt',
      'size=1024m',
      '--env',
      'CI=1',
      'oven/bun:1.3',
      'bun',
      'test',
    ])
  })

  test('prewarms image and warm commands when requested', async () => {
    const runner = new FakeLocalRunner()
    const substrate = new DockerAgenticSandboxSubstrate(runner)

    await substrate.prepare({
      id: 'warm-container',
      cwd: '/repo',
      purpose: 'warm test',
      cache: {
        image: 'oven/bun:1.3',
        warm: true,
        warmCommands: ['bun install --frozen-lockfile'],
      },
    })

    expect(
      runner.commands.map(command => [command.command, command.args]),
    ).toEqual([
      ['docker', ['pull', 'oven/bun:1.3']],
      [
        'docker',
        [
          'run',
          '--rm',
          '--workdir',
          '/workspace',
          '--volume',
          '/repo:/workspace',
          'oven/bun:1.3',
          'sh',
          '-lc',
          'bun install --frozen-lockfile',
        ],
      ],
    ])
  })
})

describe('createAgenticSandboxVerificationExecutor', () => {
  test('adapts verification commands into sandbox traces', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agentic-sandbox-verifier-'))
    const traceDir = join(cwd, 'traces')
    const command: VerificationCommand = {
      kind: 'test',
      name: 'Focused test',
      command: 'bun',
      args: ['--version'],
      cwd,
      timeoutMs: 1000,
    }

    try {
      const executor = createAgenticSandboxVerificationExecutor({
        sessionId: 'verify-sandbox',
        traceDir,
        metadata: {
          fixture: true,
        },
      })
      const result = await executor(command)

      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBeUndefined()

      const manifest = await readManifest(
        join(traceDir, 'verify-sandbox-focused-test.sandbox.json'),
      )
      expect(manifest).toMatchObject({
        sessionId: 'verify-sandbox-focused-test',
        purpose: 'verification',
        metadata: {
          commandKind: 'test',
          commandName: 'Focused test',
          fixture: true,
        },
        summary: {
          commandCount: 1,
          succeeded: 1,
        },
      })
      expect(manifest.commands[0]?.description).toBe('Focused test')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

async function readManifest(path: string): Promise<AgenticSandboxManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as AgenticSandboxManifest
}

class FakeSubstrate implements AgenticSandboxSubstrate {
  readonly commands: AgenticSandboxCommand[] = []

  constructor(readonly kind: AgenticSandboxSubstrate['kind']) {}

  async prepare(
    request: AgenticSandboxRequest,
  ): Promise<AgenticSandboxPrepareResult> {
    return {
      substrate: this.kind,
      cwd: request.cwd,
      traceDir: request.traceDir ?? request.cwd,
      resourceLimits: request.resourceLimits ?? {},
    }
  }

  async runCommand(
    command: AgenticSandboxCommand,
  ): Promise<AgenticSandboxCommandResult> {
    this.commands.push(command)
    return {
      commandId: command.id ?? '',
      status: 'completed',
      exitCode: 0,
      durationMs: 1,
      stdout: 'ok',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }
}

class FakeLocalRunner {
  readonly kind = 'local'
  readonly commands: AgenticSandboxCommand[] = []

  async prepare(
    request: AgenticSandboxRequest,
  ): Promise<AgenticSandboxPrepareResult> {
    return {
      substrate: 'local',
      cwd: request.cwd,
      traceDir: request.traceDir ?? request.cwd,
      resourceLimits: request.resourceLimits ?? {},
    }
  }

  async runCommand(
    command: AgenticSandboxCommand,
  ): Promise<AgenticSandboxCommandResult> {
    this.commands.push(command)
    return {
      commandId: command.id ?? '',
      status: 'completed',
      exitCode: 0,
      durationMs: 1,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }
}
