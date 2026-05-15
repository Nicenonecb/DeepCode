import { join } from 'node:path'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export type VerificationCommandKind = 'typecheck' | 'lint' | 'test'

export type VerificationStatus = 'passed' | 'failed' | 'timed_out'

export type VerificationIssueKind =
  | 'typescript'
  | 'lint'
  | 'test'
  | 'timeout'
  | 'command'

export type VerificationIssue = {
  kind: VerificationIssueKind
  message: string
  filePath?: string
  line?: number
  column?: number
  code?: string
  testName?: string
}

export type VerificationCommand = {
  kind: VerificationCommandKind
  name: string
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}

export type VerificationCommandConfig =
  | string
  | {
      kind?: VerificationCommandKind
      name?: string
      command: string
      args?: string[]
      timeoutMs?: number
    }

export type VerificationRunnerSettings = {
  enabled?: boolean
  commands?: VerificationCommandConfig[]
  timeoutMs?: number
  runOnCompletion?: boolean
}

export type VerificationResult = VerificationCommand & {
  status: VerificationStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  issues: VerificationIssue[]
  keyLogs: string[]
  error?: string
}

export type VerificationSummary = {
  status: VerificationStatus
  total: number
  passed: number
  failed: number
  timedOut: number
  durationMs: number
  results: VerificationResult[]
}

export type VerificationRunnerOptions = {
  cwd: string
  timeoutMs?: number
  maxOutputChars?: number
  packageJsonPath?: string
  settings?: VerificationRunnerSettings
  executor?: VerificationCommandExecutor
}

export type VerificationCommandExecutor = (
  command: VerificationCommand,
) => Promise<VerificationCommandExecutionResult>

export type VerificationCommandExecutionResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
  error?: string
}

type PackageJson = {
  scripts?: Record<string, string>
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_MAX_OUTPUT_CHARS = 12_000
const MAX_ISSUES = 20
const MAX_KEY_LOG_LINES = 12

export class VerificationRunner {
  private readonly cwd: string
  private readonly timeoutMs: number
  private readonly maxOutputChars: number
  private readonly packageJsonPath: string
  private readonly settings: VerificationRunnerSettings
  private readonly executor: VerificationCommandExecutor

  constructor(options: VerificationRunnerOptions) {
    this.cwd = options.cwd
    this.settings = options.settings ?? {}
    this.timeoutMs =
      options.timeoutMs ??
      normalizeTimeoutMs(this.settings.timeoutMs) ??
      DEFAULT_TIMEOUT_MS
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
    this.packageJsonPath =
      options.packageJsonPath ?? join(options.cwd, 'package.json')
    this.executor = options.executor ?? executeVerificationCommand
  }

  async detectCommands(): Promise<VerificationCommand[]> {
    if (!isVerificationRunnerEnabled(this.settings)) {
      return []
    }
    const packageJson = await readPackageJson(this.packageJsonPath)
    return detectVerificationCommands({
      cwd: this.cwd,
      scripts: packageJson.scripts ?? {},
      timeoutMs: this.timeoutMs,
      configuredCommands: this.settings.commands,
    })
  }

  async run(): Promise<VerificationSummary> {
    const commands = await this.detectCommands()
    const startedAt = Date.now()
    const results: VerificationResult[] = []

    for (const command of commands) {
      results.push(await this.runCommand(command))
    }

    return summarizeVerificationResults(results, Date.now() - startedAt)
  }

  private async runCommand(
    command: VerificationCommand,
  ): Promise<VerificationResult> {
    const startedAt = Date.now()
    const result = await this.executor(command)
    const status = resolveStatus(result)
    const stdout = truncateLog(result.stdout, this.maxOutputChars)
    const stderr = truncateLog(result.stderr, this.maxOutputChars)
    const parsed = parseVerificationOutput(command, {
      exitCode: result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut: result.timedOut,
      error: result.error,
    })

    return {
      ...command,
      status,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      issues: parsed.issues,
      keyLogs: parsed.keyLogs,
      ...(result.error ? { error: result.error } : {}),
    }
  }
}

export function detectVerificationCommands({
  cwd,
  scripts,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  configuredCommands,
}: {
  cwd: string
  scripts: Record<string, string>
  timeoutMs?: number
  configuredCommands?: VerificationCommandConfig[]
}): VerificationCommand[] {
  if (configuredCommands && configuredCommands.length > 0) {
    return configuredCommands
      .map((command, index) =>
        normalizeConfiguredCommand(command, cwd, timeoutMs, index),
      )
      .filter((command): command is VerificationCommand => command !== null)
  }

  const commands: VerificationCommand[] = []

  if (scripts.typecheck) {
    commands.push(makeCommand('typecheck', 'Typecheck', ['run', 'typecheck']))
  }
  if (scripts.lint) {
    commands.push(makeCommand('lint', 'Lint', ['run', 'lint']))
  }
  if (scripts['test:all']) {
    commands.push(makeCommand('test', 'Test', ['run', 'test:all']))
  } else if (scripts.test) {
    commands.push(makeCommand('test', 'Test', ['test']))
  }

  return commands

  function makeCommand(
    kind: VerificationCommandKind,
    name: string,
    args: string[],
  ): VerificationCommand {
    return {
      kind,
      name,
      command: 'bun',
      args,
      cwd,
      timeoutMs,
    }
  }
}

export function isVerificationRunnerEnabled(
  settings?: VerificationRunnerSettings,
): boolean {
  return settings?.enabled !== false
}

export function shouldRunVerificationOnCompletion(
  settings?: VerificationRunnerSettings,
): boolean {
  return (
    isVerificationRunnerEnabled(settings) && settings?.runOnCompletion !== false
  )
}

export function summarizeVerificationResults(
  results: VerificationResult[],
  durationMs = results.reduce((sum, result) => sum + result.durationMs, 0),
): VerificationSummary {
  const passed = results.filter(result => result.status === 'passed').length
  const failed = results.filter(result => result.status === 'failed').length
  const timedOut = results.filter(
    result => result.status === 'timed_out',
  ).length
  const status: VerificationStatus =
    timedOut > 0 ? 'timed_out' : failed > 0 ? 'failed' : 'passed'

  return {
    status,
    total: results.length,
    passed,
    failed,
    timedOut,
    durationMs,
    results,
  }
}

export function parseVerificationOutput(
  command: Pick<VerificationCommand, 'kind' | 'name'>,
  result: VerificationCommandExecutionResult,
): Pick<VerificationResult, 'issues' | 'keyLogs'> {
  const lines = splitLines(
    [result.stdout, result.stderr, result.error].join('\n'),
  )
  const combinedOutput = [result.stdout, result.stderr, result.error].join('\n')
  const issues: VerificationIssue[] =
    command.kind === 'test' ? parseTestIssues(lines, combinedOutput) : []

  if (command.kind !== 'test') {
    for (const line of lines) {
      const issue =
        command.kind === 'typecheck'
          ? parseTypeScriptIssue(line)
          : parseLintIssue(line)
      if (issue) {
        issues.push(issue)
      }
      if (issues.length >= MAX_ISSUES) break
    }
  }

  if (result.timedOut) {
    issues.unshift({
      kind: 'timeout',
      message: `${command.name} timed out before completion.`,
    })
  } else if (result.exitCode !== 0 && issues.length === 0) {
    issues.push({
      kind: 'command',
      message:
        result.error ??
        lastMeaningfulLine(lines) ??
        `${command.name} exited with code ${result.exitCode ?? 'unknown'}.`,
    })
  }

  return {
    issues,
    keyLogs: extractKeyLogs(lines),
  }
}

export function formatVerificationSummary(
  summary: VerificationSummary,
): string {
  const lines = [
    '<verification_result>',
    `status: ${summary.status}`,
    `commands: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.timedOut} timed out`,
    `duration_ms: ${summary.durationMs}`,
    '',
    'command_results:',
  ]

  for (const result of summary.results) {
    lines.push(
      `- ${result.name}: ${result.status} (${formatCommand(result)}, exit ${result.exitCode ?? 'null'}, ${result.durationMs}ms)`,
    )
    if (result.stdoutTruncated || result.stderrTruncated) {
      lines.push(
        `  logs_truncated: stdout=${result.stdoutTruncated}, stderr=${result.stderrTruncated}`,
      )
    }
  }

  const issues = summary.results.flatMap(result =>
    result.issues.map(issue => ({ result, issue })),
  )
  if (issues.length > 0) {
    lines.push('', 'issues:')
    for (const { result, issue } of issues.slice(0, MAX_ISSUES)) {
      lines.push(`- ${result.name}: ${formatIssue(issue)}`)
    }
  }

  const failingLogs = summary.results
    .filter(result => result.status !== 'passed')
    .flatMap(result => result.keyLogs.map(line => `- ${result.name}: ${line}`))
    .slice(0, MAX_KEY_LOG_LINES)
  if (failingLogs.length > 0) {
    lines.push('', 'key_logs:', ...failingLogs)
  }

  lines.push(
    '',
    summary.status === 'passed'
      ? 'completion_assessment: verification passed; the task can be considered complete if the requested work is done.'
      : 'completion_assessment: verification failed; do not final-reply yet. Fix the issues above, then run verification again.',
    '</verification_result>',
  )

  return lines.join('\n')
}

export function formatVerificationStatusMessage(
  summary: VerificationSummary,
): string {
  const prefix =
    summary.status === 'passed'
      ? 'Verification passed'
      : summary.status === 'timed_out'
        ? 'Verification timed out'
        : 'Verification failed'
  const counts = `${summary.passed}/${summary.total} commands passed`
  const firstIssue = summary.results.flatMap(result => result.issues)[0]
  return firstIssue
    ? `${prefix}: ${counts}. ${formatIssue(firstIssue)}`
    : `${prefix}: ${counts}.`
}

async function readPackageJson(path: string): Promise<PackageJson> {
  try {
    return (await Bun.file(path).json()) as PackageJson
  } catch {
    return {}
  }
}

function resolveStatus(
  result: VerificationCommandExecutionResult,
): VerificationStatus {
  if (result.timedOut) return 'timed_out'
  return result.exitCode === 0 ? 'passed' : 'failed'
}

function normalizeConfiguredCommand(
  config: VerificationCommandConfig,
  cwd: string,
  defaultTimeoutMs: number,
  index: number,
): VerificationCommand | null {
  const parsed =
    typeof config === 'string'
      ? parseCommandString(config)
      : config.args
        ? { command: config.command, args: config.args }
        : parseCommandString(config.command)

  if (!parsed) return null

  const kind =
    typeof config === 'string'
      ? inferCommandKind(parsed.command, parsed.args)
      : (config.kind ?? inferCommandKind(parsed.command, parsed.args))
  const configuredTimeout =
    typeof config === 'string'
      ? undefined
      : normalizeTimeoutMs(config.timeoutMs)

  return {
    kind,
    name:
      typeof config === 'string'
        ? defaultCommandName(kind, index)
        : (config.name ?? defaultCommandName(kind, index)),
    command: parsed.command,
    args: parsed.args,
    cwd,
    timeoutMs: configuredTimeout ?? defaultTimeoutMs,
  }
}

function parseCommandString(
  commandString: string,
): { command: string; args: string[] } | null {
  const tokens = parseArguments(commandString)
  const command = tokens[0]
  if (!command) return null
  return {
    command,
    args: tokens.slice(1),
  }
}

function inferCommandKind(
  command: string,
  args: string[],
): VerificationCommandKind {
  const text = [command, ...args].join(' ').toLowerCase()
  if (/\btsc\b|typecheck/.test(text)) return 'typecheck'
  if (/\bbiome\b|\beslint\b|\blint\b/.test(text)) return 'lint'
  return 'test'
}

function defaultCommandName(
  kind: VerificationCommandKind,
  index: number,
): string {
  if (kind === 'typecheck') return 'Typecheck'
  if (kind === 'lint') return 'Lint'
  if (kind === 'test') return 'Test'
  return `Verification ${index + 1}`
}

function normalizeTimeoutMs(timeoutMs: unknown): number | undefined {
  return typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
    ? timeoutMs
    : undefined
}

function parseTypeScriptIssue(line: string): VerificationIssue | null {
  const parenMatch = line.match(
    /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+)(?::\s+(.+))?$/,
  )
  if (parenMatch) {
    return {
      kind: 'typescript',
      filePath: parenMatch[1],
      line: Number(parenMatch[2]),
      column: Number(parenMatch[3]),
      code: parenMatch[4],
      message: parenMatch[5] ?? line,
    }
  }

  const colonMatch = line.match(
    /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+)(?::\s+(.+))?$/,
  )
  if (colonMatch) {
    return {
      kind: 'typescript',
      filePath: colonMatch[1],
      line: Number(colonMatch[2]),
      column: Number(colonMatch[3]),
      code: colonMatch[4],
      message: colonMatch[5] ?? line,
    }
  }

  const bareMatch = line.match(/\berror\s+(TS\d+):\s+(.+)$/)
  if (bareMatch) {
    return {
      kind: 'typescript',
      code: bareMatch[1],
      message: bareMatch[2] ?? line,
    }
  }

  return null
}

function parseLintIssue(line: string): VerificationIssue | null {
  const lintMatch = line.match(
    /^(.+?):(\d+):(\d+)\s+(lint\/[^\s]+|error|warning)\s*(.*)$/,
  )
  if (lintMatch) {
    return {
      kind: 'lint',
      filePath: lintMatch[1],
      line: Number(lintMatch[2]),
      column: Number(lintMatch[3]),
      code: lintMatch[4],
      message: (lintMatch[5] || lintMatch[4] || line).trim(),
    }
  }

  const eslintMatch = line.match(
    /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([@\w/-]+)$/,
  )
  if (eslintMatch) {
    return {
      kind: 'lint',
      line: Number(eslintMatch[1]),
      column: Number(eslintMatch[2]),
      code: eslintMatch[5],
      message: eslintMatch[4] ?? line,
    }
  }

  return null
}

function parseTestIssues(
  lines: string[],
  combinedOutput: string,
): VerificationIssue[] {
  const issues = parseJUnitIssues(combinedOutput)

  for (
    let index = 0;
    index < lines.length && issues.length < MAX_ISSUES;
    index++
  ) {
    const issue = parseReporterTestIssue(lines[index]!)
    if (!issue) continue

    const location = findNearbyFileLocation(lines, index)
    issues.push({
      ...issue,
      ...(location ?? {}),
    })
  }

  return issues.slice(0, MAX_ISSUES)
}

function parseJUnitIssues(output: string): VerificationIssue[] {
  const issues: VerificationIssue[] = []
  const testcaseRegex = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g
  for (const match of output.matchAll(testcaseRegex)) {
    const attrs = parseXmlAttrs(match[1] ?? '')
    const body = match[2] ?? ''
    const failureMatch = body.match(
      /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/,
    )
    if (!failureMatch) continue

    const failureAttrs = parseXmlAttrs(failureMatch[2] ?? '')
    const failureText = decodeXmlEntities(stripXml(failureMatch[3] ?? ''))
    const message =
      failureAttrs.message ??
      firstMeaningfulLine(splitLines(failureText)) ??
      `${attrs.name ?? 'Test'} failed`
    const location = findFileLocation(
      [attrs.file, failureAttrs.file, failureText, message]
        .filter((value): value is string => typeof value === 'string')
        .join('\n'),
    )

    issues.push({
      kind: 'test',
      testName: [attrs.classname, attrs.name].filter(Boolean).join(' > '),
      message,
      ...(location ?? {}),
    })
    if (issues.length >= MAX_ISSUES) break
  }

  return issues
}

function parseReporterTestIssue(line: string): VerificationIssue | null {
  const bunFailMatch = line.match(/^\s*\(fail\)\s+(.+?)(?:\s+\[[^\]]+\])?$/)
  if (bunFailMatch) {
    return {
      kind: 'test',
      testName: bunFailMatch[1],
      message: bunFailMatch[1] ?? line,
    }
  }

  const suiteFileMatch = line.match(
    /^\s*(?:FAIL|fail)\s+([^\s]+?\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s+>\s+(.+))?$/i,
  )
  if (suiteFileMatch) {
    return {
      kind: 'test',
      filePath: suiteFileMatch[1],
      testName: suiteFileMatch[2],
      message: suiteFileMatch[2] ?? `${suiteFileMatch[1]} failed`,
    }
  }

  const markerMatch = line.match(/^\s*(?:✗|×|x|FAIL|fail)\s+(.+)$/i)
  if (markerMatch) {
    return {
      kind: 'test',
      testName: markerMatch[1],
      message: markerMatch[1] ?? line,
    }
  }

  return null
}

function findNearbyFileLocation(
  lines: string[],
  startIndex: number,
): Pick<VerificationIssue, 'filePath' | 'line' | 'column'> | undefined {
  for (
    let index = startIndex;
    index < Math.min(lines.length, startIndex + 8);
    index++
  ) {
    const location = findFileLocation(lines[index]!)
    if (location) return location
  }
  return undefined
}

function findFileLocation(
  text: string,
): Pick<VerificationIssue, 'filePath' | 'line' | 'column'> | undefined {
  const match = text.match(
    /([^\s()<>:]+\.(?:test|spec)?\.?[cm]?[jt]sx?):(\d+)(?::(\d+))?/,
  )
  if (!match) return undefined
  return {
    filePath: match[1],
    line: Number(match[2]),
    ...(match[3] ? { column: Number(match[3]) } : {}),
  }
}

function parseXmlAttrs(attrs: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of attrs.matchAll(/\s+([:\w-]+)="([^"]*)"/g)) {
    result[match[1]!] = decodeXmlEntities(match[2] ?? '')
  }
  return result
}

function stripXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function truncateLog(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }

  const marker = '\n...[verification log truncated]...\n'
  const headLength = Math.max(0, Math.floor((maxChars - marker.length) / 2))
  const tailLength = Math.max(0, maxChars - marker.length - headLength)
  return {
    text: `${text.slice(0, headLength)}${marker}${text.slice(text.length - tailLength)}`,
    truncated: true,
  }
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
}

function extractKeyLogs(lines: string[]): string[] {
  return lines
    .filter(line =>
      /error|failed|fail|timed out|exception|TS\d+|lint\//i.test(line),
    )
    .slice(-MAX_KEY_LOG_LINES)
}

function lastMeaningfulLine(lines: string[]): string | undefined {
  return lines.at(-1)
}

function firstMeaningfulLine(lines: string[]): string | undefined {
  return lines[0]
}

function formatCommand(result: VerificationResult): string {
  return [result.command, ...result.args].join(' ')
}

function formatIssue(issue: VerificationIssue): string {
  const location =
    issue.filePath !== undefined
      ? `${issue.filePath}${issue.line !== undefined ? `:${issue.line}` : ''}${issue.column !== undefined ? `:${issue.column}` : ''}`
      : undefined
  const prefix = [
    `[${issue.kind}]`,
    location,
    issue.code,
    issue.testName ? `test="${issue.testName}"` : undefined,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' ')
  return `${prefix}: ${issue.message}`
}

export async function executeVerificationCommand(
  command: VerificationCommand,
): Promise<VerificationCommandExecutionResult> {
  const proc = Bun.spawn([command.command, ...command.args], {
    cwd: command.cwd,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, command.timeoutMs)

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    return {
      exitCode,
      stdout,
      stderr,
      ...(timedOut ? { timedOut } : {}),
    }
  } catch (error) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      ...(timedOut ? { timedOut } : {}),
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}
