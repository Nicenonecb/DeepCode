import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type {
  AgenticSandboxCacheSpec,
  AgenticSandboxCacheState,
  AgenticSandboxCommandTrace,
  AgenticSandboxReplayPlan,
  AgenticSandboxWorkspaceSnapshot,
} from './types.js'

const CACHE_INPUT_FILES = [
  'package.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
]

const SNAPSHOT_MAX_FILES = 200

export async function resolveAgenticSandboxCacheState({
  cwd,
  cache,
}: {
  cwd: string
  cache?: AgenticSandboxCacheSpec
}): Promise<AgenticSandboxCacheState> {
  if (cache?.cacheKey) {
    return {
      image: cache.image,
      cacheKey: cache.cacheKey,
      keySource: 'explicit',
      warmRequested: cache.warm === true,
      warmCommands: cache.warmCommands ?? [],
    }
  }

  const workspaceHash = createHash('sha256')
  let found = false
  for (const file of CACHE_INPUT_FILES) {
    try {
      const bytes = await readFile(join(cwd, file))
      workspaceHash.update(file)
      workspaceHash.update(bytes)
      found = true
    } catch {
      // Missing lockfiles are normal for small fixtures.
    }
  }

  if (!found) {
    workspaceHash.update(cwd)
  }

  return {
    image: cache?.image,
    cacheKey: `workspace-${workspaceHash.digest('hex').slice(0, 16)}`,
    keySource: 'workspace',
    warmRequested: cache?.warm === true,
    warmCommands: cache?.warmCommands ?? [],
  }
}

export async function createWorkspaceSnapshot({
  cwd,
  traceDir,
  sessionId,
  now,
}: {
  cwd: string
  traceDir: string
  sessionId: string
  now: Date
}): Promise<AgenticSandboxWorkspaceSnapshot> {
  const files = await listSnapshotFiles(cwd)
  const snapshot: AgenticSandboxWorkspaceSnapshot = {
    id: `${sessionId}-snapshot`,
    path: join(traceDir, `${sessionId}.snapshot.json`),
    createdAt: now.toISOString(),
    cwd,
    files,
  }
  await mkdir(traceDir, { recursive: true })
  await writeFile(snapshot.path, `${JSON.stringify(snapshot, null, 2)}\n`)
  return snapshot
}

export async function writeReplayPlan({
  traceDir,
  sessionId,
  manifestPath,
  commands,
}: {
  traceDir: string
  sessionId: string
  manifestPath: string
  commands: AgenticSandboxCommandTrace[]
}): Promise<AgenticSandboxReplayPlan> {
  await mkdir(traceDir, { recursive: true })
  const scriptPath = join(traceDir, `${sessionId}.replay.sh`)
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `# Replay plan generated from ${basename(manifestPath)}`,
    '',
  ]
  for (const command of commands) {
    lines.push(
      `cd ${shellQuote(command.cwd)}`,
      shellJoin([command.command, ...command.args]),
      '',
    )
  }
  await writeFile(scriptPath, lines.join('\n'))
  return {
    scriptPath,
    manifestPath,
    commandCount: commands.length,
    restoreHint:
      commands.length > 0
        ? `Review ${manifestPath}, restore files from the snapshot if needed, then run ${scriptPath}.`
        : undefined,
  }
}

async function listSnapshotFiles(
  cwd: string,
): Promise<AgenticSandboxWorkspaceSnapshot['files']> {
  const entries: AgenticSandboxWorkspaceSnapshot['files'] = []
  await visit(cwd, '')
  return entries.sort((a, b) => a.path.localeCompare(b.path))

  async function visit(absDir: string, relDir: string): Promise<void> {
    if (entries.length >= SNAPSHOT_MAX_FILES) return
    let names: string[]
    try {
      names = await readdir(absDir)
    } catch {
      return
    }

    for (const name of names) {
      if (entries.length >= SNAPSHOT_MAX_FILES) return
      if (shouldSkipPath(name)) continue
      const absPath = join(absDir, name)
      const relPath = relDir ? join(relDir, name) : name
      const info = await stat(absPath).catch(() => null)
      if (!info) continue
      if (info.isDirectory()) {
        await visit(absPath, relPath)
        continue
      }
      if (!info.isFile()) continue
      const bytes = await readFile(absPath).catch(() => null)
      if (!bytes) continue
      entries.push({
        path: relative(cwd, absPath),
        sizeBytes: info.size,
        mtimeMs: info.mtimeMs,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
  }
}

function shouldSkipPath(name: string): boolean {
  return (
    name === '.git' ||
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.deepcode' ||
    name === '.DS_Store'
  )
}

function shellJoin(parts: string[]): string {
  return parts.map(shellQuote).join(' ')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
