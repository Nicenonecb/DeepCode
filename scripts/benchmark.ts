#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  BenchmarkHarness,
  agenticSearchBenchmarkExecutor,
} from '../src/services/benchmark/BenchmarkHarness.js'
import {
  formatBenchmarkJsonReport,
  formatBenchmarkMarkdownReport,
} from '../src/services/benchmark/Reporter.js'
import type {
  BenchmarkCandidateCommand,
  BenchmarkHarnessMode,
  BenchmarkHarnessRequest,
  BenchmarkTaskDataset,
} from '../src/services/benchmark/types.js'
import type { VerificationCommandConfig } from '../src/services/verification/index.js'

type BenchmarkFixtureFile = {
  id?: string
  dataset: BenchmarkTaskDataset
  candidates?: BenchmarkCandidateCommand[]
  verificationCommands?: VerificationCommandConfig[]
}

type BenchmarkCliOptions = {
  fixturePath: string
  format: 'markdown' | 'json'
  mode: BenchmarkHarnessMode
  maxTasks?: number
  outputPath?: string
}

const DEFAULT_FIXTURE = 'tests/benchmark/fixtures/smoke.json'

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const fixture = await readFixture(options.fixturePath)
  const request: BenchmarkHarnessRequest = {
    id: fixture.id ?? fixture.dataset.id,
    dataset: fixture.dataset,
    candidates:
      fixture.candidates && fixture.candidates.length > 0
        ? fixture.candidates
        : [{ id: 'dry-run', label: 'Dry run', kind: 'cli' }],
    mode: options.mode,
    ...(options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks }),
    ...(fixture.verificationCommands
      ? { verificationCommands: fixture.verificationCommands }
      : {}),
  }

  const result = await new BenchmarkHarness({
    executor: selectExecutor(request.id),
  }).run(request)
  const output =
    options.format === 'json'
      ? formatBenchmarkJsonReport(result)
      : formatBenchmarkMarkdownReport(result)

  if (options.outputPath) {
    const outputPath = resolve(options.outputPath)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, output)
  } else {
    process.stdout.write(output)
  }
}

function selectExecutor(
  requestId: string,
): ConstructorParameters<typeof BenchmarkHarness>[0]['executor'] {
  if (requestId.includes('agentic-search')) {
    return agenticSearchBenchmarkExecutor
  }
  return undefined
}

function parseArgs(args: string[]): BenchmarkCliOptions {
  const options: BenchmarkCliOptions = {
    fixturePath: DEFAULT_FIXTURE,
    format: 'markdown',
    mode: 'dry_run',
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--fixture') {
      options.fixturePath = requireValue(args, ++index, arg)
    } else if (arg.startsWith('--fixture=')) {
      options.fixturePath = arg.slice('--fixture='.length)
    } else if (arg === '--format') {
      options.format = parseFormat(requireValue(args, ++index, arg))
    } else if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length))
    } else if (arg === '--mode') {
      options.mode = parseMode(requireValue(args, ++index, arg))
    } else if (arg.startsWith('--mode=')) {
      options.mode = parseMode(arg.slice('--mode='.length))
    } else if (arg === '--max-tasks') {
      options.maxTasks = parsePositiveInteger(requireValue(args, ++index, arg))
    } else if (arg.startsWith('--max-tasks=')) {
      options.maxTasks = parsePositiveInteger(arg.slice('--max-tasks='.length))
    } else if (arg === '--output') {
      options.outputPath = requireValue(args, ++index, arg)
    } else if (arg.startsWith('--output=')) {
      options.outputPath = arg.slice('--output='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown benchmark option: ${arg}`)
    }
  }

  return options
}

async function readFixture(path: string): Promise<BenchmarkFixtureFile> {
  const raw = await readFile(resolve(path), 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!isBenchmarkFixtureFile(parsed)) {
    throw new Error(`Invalid benchmark fixture: ${path}`)
  }
  return parsed
}

function isBenchmarkFixtureFile(value: unknown): value is BenchmarkFixtureFile {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const dataset = record.dataset
  if (!dataset || typeof dataset !== 'object') return false
  const datasetRecord = dataset as Record<string, unknown>
  return (
    typeof datasetRecord.id === 'string' &&
    typeof datasetRecord.name === 'string' &&
    Array.isArray(datasetRecord.tasks)
  )
}

function parseFormat(value: string): BenchmarkCliOptions['format'] {
  if (value === 'markdown' || value === 'json') return value
  throw new Error(`Unsupported benchmark format: ${value}`)
}

function parseMode(value: string): BenchmarkHarnessMode {
  if (value === 'dry_run' || value === 'execute') return value
  throw new Error(`Unsupported benchmark mode: ${value}`)
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got: ${value}`)
  }
  return parsed
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value) throw new Error(`Missing value for ${flag}`)
  return value
}

function printHelp(): void {
  process.stdout.write(`Usage: bun run scripts/benchmark.ts [options]

Options:
  --fixture <path>    Fixture JSON path. Defaults to ${DEFAULT_FIXTURE}
  --format <name>     markdown or json. Defaults to markdown
  --mode <name>       dry_run or execute. Defaults to dry_run
  --max-tasks <n>     Limit tasks for smoke runs
  --output <path>     Write report to a file instead of stdout
`)
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
