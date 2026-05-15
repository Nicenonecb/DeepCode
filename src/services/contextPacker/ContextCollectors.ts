import { readFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSymbolAtPosition } from '@deepcode/builtin-tools/tools/LSPTool/symbolContext.js'
import type { DiagnosticFile } from '../diagnosticTracking.js'
import { peekPendingLSPDiagnostics } from '../lsp/LSPDiagnosticRegistry.js'
import { getPatchFromContents } from '../../utils/diff.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { gitExe } from '../../utils/git.js'
import {
  detectVerificationCommands,
  type VerificationSummary,
} from '../verification/index.js'
import type {
  ContextPackDiagnostic,
  ContextPackFile,
  ContextPackInput,
  ContextPackLspContext,
  ContextPackSymbol,
} from './ContextPacker.js'

export type ContextEvidenceCollectorsOptions = {
  cwd: string
  taskPrompt?: string
  packageJsonPath?: string
  verificationSummary?: VerificationSummary
  lsp?: ContextPackLspContext
  lspDiagnosticProvider?: LspDiagnosticProvider
  symbolAtPosition?: SymbolAtPosition
  gitExecutor?: GitEvidenceExecutor
  fileLister?: FileLister
  readTextFile?: ReadTextFile
}

export type GitEvidenceExecutor = (
  args: string[],
  cwd: string,
) => Promise<GitEvidenceCommandResult>

export type GitEvidenceCommandResult = {
  code: number
  stdout: string
  stderr?: string
}

export type FileLister = (cwd: string) => Promise<string[]>
export type ReadTextFile = (path: string) => Promise<string>
export type LspDiagnosticProvider = () => Array<{
  serverName: string
  files: DiagnosticFile[]
}>
export type SymbolAtPosition = (
  filePath: string,
  line: number,
  character: number,
) => string | null

export type GitContextEvidence = {
  diff: string
  changedFiles: string[]
}

export type ContentDiffEvidenceInput = {
  filePath: string
  oldContent: string
  newContent: string
}

type PackageJson = {
  scripts?: Record<string, string>
}

const GIT_TIMEOUT_MS = 5000
const MAX_RELATED_FILES = 30
const MAX_LSP_DIAGNOSTICS = 20
const MAX_LSP_SYMBOLS = 20

export async function collectContextPackInput(
  options: ContextEvidenceCollectorsOptions,
): Promise<ContextPackInput> {
  const readTextFile = options.readTextFile ?? readFileUtf8
  const [gitEvidence, packageScripts, allFiles] = await Promise.all([
    collectGitEvidence({
      cwd: options.cwd,
      gitExecutor: options.gitExecutor,
    }),
    collectPackageScripts({
      cwd: options.cwd,
      packageJsonPath: options.packageJsonPath,
      readTextFile,
    }),
    (options.fileLister ?? listFilesWithGit)(options.cwd),
  ])

  const verificationEvidence = collectVerificationEvidence(
    options.verificationSummary,
  )
  const lspEvidence = collectLspEvidence({
    cwd: options.cwd,
    changedFiles: gitEvidence.changedFiles,
    verificationSummary: options.verificationSummary,
    explicitLsp: options.lsp,
    diagnosticProvider: options.lspDiagnosticProvider,
    symbolAtPosition: options.symbolAtPosition,
  })
  const relatedFiles = mergeRelatedFiles(
    findRelatedTestFiles(gitEvidence.changedFiles, allFiles).map(filePath => ({
      path: filePath,
      reason: 'related test',
    })),
    verificationEvidence.relatedFiles,
    lspEvidence.relatedFiles,
  )
  const verificationCommands = detectVerificationCommands({
    cwd: options.cwd,
    scripts: packageScripts,
  })
  const testHints = [
    ...verificationCommands.map(
      command =>
        `Detected verifier: ${command.command} ${command.args.join(' ')}`,
    ),
    ...verificationEvidence.testHints,
  ]

  return {
    cwd: options.cwd,
    ...(options.taskPrompt ? { taskPrompt: options.taskPrompt } : {}),
    diff: gitEvidence.diff,
    changedFiles: gitEvidence.changedFiles,
    packageScripts,
    relatedFiles,
    testHints,
    ...(options.verificationSummary
      ? { verificationSummary: options.verificationSummary }
      : {}),
    ...(hasLspEvidence(lspEvidence.lsp) ? { lsp: lspEvidence.lsp } : {}),
  }
}

export async function collectGitEvidence({
  cwd,
  gitExecutor = executeGitEvidenceCommand,
}: {
  cwd: string
  gitExecutor?: GitEvidenceExecutor
}): Promise<GitContextEvidence> {
  const [diffResult, trackedResult, untrackedResult] = await Promise.all([
    gitExecutor(['--no-optional-locks', 'diff', 'HEAD'], cwd),
    gitExecutor(['--no-optional-locks', 'diff', '--name-only', 'HEAD'], cwd),
    gitExecutor(
      ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard'],
      cwd,
    ),
  ])

  return {
    diff: diffResult.code === 0 ? diffResult.stdout : '',
    changedFiles: uniqueNonEmptyLines(
      [
        trackedResult.code === 0 ? trackedResult.stdout : '',
        untrackedResult.code === 0 ? untrackedResult.stdout : '',
      ].join('\n'),
    ),
  }
}

export async function collectPackageScripts({
  cwd,
  packageJsonPath = join(cwd, 'package.json'),
  readTextFile = readFileUtf8,
}: {
  cwd: string
  packageJsonPath?: string
  readTextFile?: ReadTextFile
}): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(
      await readTextFile(packageJsonPath),
    ) as PackageJson
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

export function collectContentDiffEvidence({
  filePath,
  oldContent,
  newContent,
}: ContentDiffEvidenceInput): GitContextEvidence {
  const hunks = getPatchFromContents({
    filePath,
    oldContent,
    newContent,
  })

  return {
    diff: formatPatchHunks(filePath, hunks),
    changedFiles: hunks.length > 0 ? [filePath] : [],
  }
}

export function collectVerificationEvidence(
  summary: VerificationSummary | undefined,
): { relatedFiles: ContextPackFile[]; testHints: string[] } {
  if (!summary) return { relatedFiles: [], testHints: [] }

  const relatedFiles: ContextPackFile[] = []
  const testHints: string[] = []

  for (const result of summary.results) {
    for (const issue of result.issues) {
      if (issue.filePath) {
        relatedFiles.push({
          path: issue.filePath,
          reason: `${result.name} ${issue.kind} issue`,
        })
      }
      if (issue.testName) {
        testHints.push(`Failing test: ${issue.testName}`)
      }
    }
  }

  if (summary.status !== 'passed') {
    testHints.push('Verification is failing; preserve error files first.')
  }

  return {
    relatedFiles: dedupeRelatedFiles(relatedFiles),
    testHints: Array.from(new Set(testHints)),
  }
}

export function findRelatedTestFiles(
  changedFiles: string[],
  allFiles: string[],
): string[] {
  const tests = allFiles.filter(isTestFile)
  const related = new Set<string>()

  for (const changedFile of changedFiles) {
    if (isTestFile(changedFile)) {
      related.add(changedFile)
      continue
    }

    const stem = stripKnownExtensions(basename(changedFile))
    const dir = dirname(changedFile)
    const parent = basename(dir)

    for (const testFile of tests) {
      const testStem = stripKnownExtensions(basename(testFile))
      if (
        testStem === stem ||
        testStem.startsWith(`${stem}.`) ||
        testFile.includes(`/${stem}.`) ||
        testFile.includes(`/${parent}/__tests__/`)
      ) {
        related.add(testFile)
      }
    }
  }

  return Array.from(related).slice(0, MAX_RELATED_FILES)
}

export function createLspContext(params: {
  diagnostics?: ContextPackDiagnostic[]
  symbols?: ContextPackSymbol[]
  references?: ContextPackLspContext['references']
}): ContextPackLspContext {
  return {
    diagnostics: params.diagnostics ?? [],
    symbols: params.symbols ?? [],
    references: params.references ?? [],
  }
}

export function collectLspEvidence({
  cwd,
  changedFiles,
  verificationSummary,
  explicitLsp,
  diagnosticProvider = peekPendingLSPDiagnostics,
  symbolAtPosition = getSymbolAtPosition,
}: {
  cwd: string
  changedFiles: string[]
  verificationSummary?: VerificationSummary
  explicitLsp?: ContextPackLspContext
  diagnosticProvider?: LspDiagnosticProvider
  symbolAtPosition?: SymbolAtPosition
}): { lsp: ContextPackLspContext; relatedFiles: ContextPackFile[] } {
  const targetFiles = collectTargetFiles(cwd, changedFiles, verificationSummary)
  const relatedFiles: ContextPackFile[] = []
  const diagnostics = [...(explicitLsp?.diagnostics ?? [])]
  const symbols = [...(explicitLsp?.symbols ?? [])]
  const references = [...(explicitLsp?.references ?? [])]

  const pendingDiagnostics = diagnosticProvider()
  for (const { files } of pendingDiagnostics) {
    for (const file of files) {
      const filePath = normalizeEvidencePath(file.uri, cwd)
      if (!isTargetPath(filePath, targetFiles)) continue

      relatedFiles.push({
        path: filePath,
        reason: 'lsp diagnostic',
      })

      for (const diagnostic of file.diagnostics) {
        diagnostics.push({
          filePath,
          message: diagnostic.message,
          line: diagnostic.range.start.line + 1,
          column: diagnostic.range.start.character + 1,
          severity: diagnostic.severity,
          source: diagnostic.source,
          code: diagnostic.code,
        })

        const nearestSymbol = symbolAtPosition(
          resolveEvidencePath(filePath, cwd),
          diagnostic.range.start.line,
          diagnostic.range.start.character,
        )
        if (nearestSymbol) {
          symbols.push({
            filePath,
            name: nearestSymbol,
            kind: 'nearest',
            line: diagnostic.range.start.line + 1,
            column: diagnostic.range.start.character + 1,
            reason: 'lsp diagnostic',
          })
        }
      }
    }
  }

  for (const issue of verificationIssues(verificationSummary)) {
    if (!issue.filePath || issue.line === undefined) continue
    const filePath = normalizeEvidencePath(issue.filePath, cwd)
    if (!isTargetPath(filePath, targetFiles)) continue

    const nearestSymbol = symbolAtPosition(
      resolveEvidencePath(filePath, cwd),
      Math.max(0, issue.line - 1),
      Math.max(0, (issue.column ?? 1) - 1),
    )
    if (nearestSymbol) {
      symbols.push({
        filePath,
        name: nearestSymbol,
        kind: 'nearest',
        line: issue.line,
        column: issue.column,
        reason: `${issue.kind} issue`,
      })
    }
  }

  return {
    lsp: {
      diagnostics: dedupeDiagnostics(diagnostics).slice(0, MAX_LSP_DIAGNOSTICS),
      symbols: dedupeSymbols(symbols).slice(0, MAX_LSP_SYMBOLS),
      references,
    },
    relatedFiles: dedupeRelatedFiles(relatedFiles),
  }
}

async function executeGitEvidenceCommand(
  args: string[],
  cwd: string,
): Promise<GitEvidenceCommandResult> {
  return execFileNoThrowWithCwd(gitExe(), args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    preserveOutputOnError: false,
  })
}

async function listFilesWithGit(cwd: string): Promise<string[]> {
  const result = await executeGitEvidenceCommand(
    [
      '--no-optional-locks',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ],
    cwd,
  )
  return result.code === 0 ? uniqueNonEmptyLines(result.stdout) : []
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}

function mergeRelatedFiles(...groups: ContextPackFile[][]): ContextPackFile[] {
  return dedupeRelatedFiles(groups.flat()).slice(0, MAX_RELATED_FILES)
}

function dedupeRelatedFiles(files: ContextPackFile[]): ContextPackFile[] {
  const indexByPath = new Map<string, number>()
  const deduped: ContextPackFile[] = []

  for (const file of files) {
    const existingIndex = indexByPath.get(file.path)
    if (existingIndex === undefined) {
      indexByPath.set(file.path, deduped.length)
      deduped.push(file)
      continue
    }

    const existing = deduped[existingIndex]
    deduped[existingIndex] = {
      ...existing,
      reason: mergeReasons(existing.reason, file.reason),
      excerpt: existing.excerpt ?? file.excerpt,
    }
  }

  return deduped
}

function mergeReasons(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  if (!first) return second
  if (!second || first === second) return first
  return `${first}; ${second}`
}

function uniqueNonEmptyLines(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean),
    ),
  )
}

function formatPatchHunks(
  filePath: string,
  hunks: ReturnType<typeof getPatchFromContents>,
): string {
  if (hunks.length === 0) return ''
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    ...hunks.flatMap(hunk => [
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      ...hunk.lines,
    ]),
  ].join('\n')
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('/__tests__/') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
  )
}

function stripKnownExtensions(fileName: string): string {
  let stem = fileName
  while (extname(stem)) {
    stem = stem.slice(0, -extname(stem).length)
  }
  return stem.replace(/\.(test|spec)$/, '')
}

function collectTargetFiles(
  cwd: string,
  changedFiles: string[],
  verificationSummary: VerificationSummary | undefined,
): Set<string> {
  return new Set(
    [
      ...changedFiles,
      ...verificationIssues(verificationSummary).flatMap(issue =>
        issue.filePath ? [issue.filePath] : [],
      ),
    ].map(filePath => normalizeEvidencePath(filePath, cwd)),
  )
}

function verificationIssues(summary: VerificationSummary | undefined) {
  return summary?.results.flatMap(result => result.issues) ?? []
}

function isTargetPath(filePath: string, targetFiles: Set<string>): boolean {
  if (targetFiles.size === 0) return true
  return targetFiles.has(filePath)
}

function normalizeEvidencePath(filePathOrUri: string, cwd: string): string {
  const filePath = uriToFilePath(filePathOrUri)
  const absolutePath = resolveEvidencePath(filePath, cwd)
  const relativePath = relative(cwd, absolutePath)
  if (relativePath && !relativePath.startsWith('..') && relativePath !== '') {
    return normalize(relativePath)
  }
  return normalize(filePath)
}

function resolveEvidencePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? normalize(filePath) : resolve(cwd, filePath)
}

function uriToFilePath(filePathOrUri: string): string {
  if (filePathOrUri.startsWith('file://')) {
    return fileURLToPath(filePathOrUri)
  }
  if (filePathOrUri.startsWith('_claude_fs_right:')) {
    return filePathOrUri.slice('_claude_fs_right:'.length)
  }
  if (filePathOrUri.startsWith('_claude_fs_left:')) {
    return filePathOrUri.slice('_claude_fs_left:'.length)
  }
  return filePathOrUri
}

function hasLspEvidence(lsp: ContextPackLspContext): boolean {
  return Boolean(
    lsp.diagnostics?.length || lsp.symbols?.length || lsp.references?.length,
  )
}

function dedupeDiagnostics(
  diagnostics: ContextPackDiagnostic[],
): ContextPackDiagnostic[] {
  const seen = new Set<string>()
  const deduped: ContextPackDiagnostic[] = []

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.filePath,
      diagnostic.line ?? '',
      diagnostic.column ?? '',
      diagnostic.severity ?? '',
      diagnostic.message,
    ].join('\0')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(diagnostic)
  }

  return deduped.sort(compareDiagnostics)
}

function compareDiagnostics(
  first: ContextPackDiagnostic,
  second: ContextPackDiagnostic,
): number {
  return (
    diagnosticSeverityRank(first.severity) -
      diagnosticSeverityRank(second.severity) ||
    first.filePath.localeCompare(second.filePath) ||
    (first.line ?? Number.MAX_SAFE_INTEGER) -
      (second.line ?? Number.MAX_SAFE_INTEGER)
  )
}

function diagnosticSeverityRank(severity: string | undefined): number {
  switch (severity?.toLowerCase()) {
    case 'error':
      return 0
    case 'warning':
      return 1
    case 'info':
      return 2
    case 'hint':
      return 3
    default:
      return 4
  }
}

function dedupeSymbols(symbols: ContextPackSymbol[]): ContextPackSymbol[] {
  const seen = new Set<string>()
  const deduped: ContextPackSymbol[] = []

  for (const symbol of symbols) {
    const key = [
      symbol.filePath,
      symbol.name,
      symbol.kind ?? '',
      symbol.line ?? '',
      symbol.column ?? '',
      symbol.reason ?? '',
    ].join('\0')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(symbol)
  }

  return deduped
}
