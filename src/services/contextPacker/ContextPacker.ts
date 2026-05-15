import type { VerificationSummary } from '../verification/index.js'

export type ContextPackSectionId =
  | 'task'
  | 'repo_map'
  | 'diff'
  | 'verification'
  | 'related_files'
  | 'test_hints'
  | 'lsp'

export type ContextPackEvidenceTier = 'hot' | 'warm' | 'cold'

export type ContextPackSection = {
  id: ContextPackSectionId
  title: string
  tier: ContextPackEvidenceTier
  priority: number
  content: string
  charCount: number
  truncated: boolean
}

export type ContextPack = {
  cwd: string
  generatedAt: number
  maxChars: number
  totalChars: number
  truncated: boolean
  sections: ContextPackSection[]
}

export type ContextPackerSettings = {
  enabled?: boolean
  maxChars?: number
  budgetSource?: 'settings' | 'model-profile'
  charsPerToken?: number
  contextWatermark?: number
  includeRepoMap?: boolean
  includeDiff?: boolean
  includeVerification?: boolean
  includeRelatedFiles?: boolean
  includeTestHints?: boolean
  includeLsp?: boolean
}

export type ContextPackInput = {
  cwd: string
  taskPrompt?: string
  repoMap?: string
  changedFiles?: string[]
  packageScripts?: Record<string, string>
  diff?: string
  verificationSummary?: VerificationSummary
  relatedFiles?: ContextPackFile[]
  recentFiles?: string[]
  testHints?: string[]
  lsp?: ContextPackLspContext
  maxChars?: number
  settings?: ContextPackerSettings
  generatedAt?: number
}

export type ContextPackRuntimeBudget = {
  maxContextTokens: number
  contextWatermark: number
  source: string
}

export type ContextPackFile = {
  path: string
  reason?: string
  excerpt?: string
}

export type ContextPackLspContext = {
  diagnostics?: ContextPackDiagnostic[]
  symbols?: ContextPackSymbol[]
  references?: ContextPackReference[]
}

export type ContextPackDiagnostic = {
  filePath: string
  message: string
  line?: number
  column?: number
  severity?: string
  source?: string
  code?: string
}

export type ContextPackSymbol = {
  filePath: string
  name: string
  kind?: string
  line?: number
  column?: number
  reason?: string
}

export type ContextPackReference = {
  filePath: string
  line?: number
  column?: number
  symbol?: string
  reason?: string
}

type DraftSection = Omit<ContextPackSection, 'charCount' | 'truncated'>

const DEFAULT_MAX_CHARS = 24_000
const DEFAULT_CHARS_PER_TOKEN = 4
const TRUNCATION_MARKER = '\n...[context pack section truncated]...'
const TIER_RANK: Record<ContextPackEvidenceTier, number> = {
  hot: 3,
  warm: 2,
  cold: 1,
}

export class ContextPacker {
  pack(input: ContextPackInput): ContextPack {
    const settings = input.settings ?? {}
    const maxChars = normalizeMaxChars(input.maxChars ?? settings.maxChars)
    const drafts = buildDraftSections(input, settings)
    const sections = applyBudget(drafts, maxChars)
    const totalChars = sections.reduce(
      (sum, section) => sum + section.charCount,
      0,
    )

    return {
      cwd: input.cwd,
      generatedAt: input.generatedAt ?? Date.now(),
      maxChars,
      totalChars,
      truncated: sections.some(section => section.truncated),
      sections,
    }
  }
}

export function isContextPackerEnabled(
  settings: ContextPackerSettings | undefined,
): boolean {
  return settings?.enabled !== false
}

export function resolveContextPackMaxChars(
  settings: ContextPackerSettings | undefined,
  runtimeBudget?: ContextPackRuntimeBudget,
): number {
  if (settings?.maxChars) return normalizeMaxChars(settings.maxChars)
  if (settings?.budgetSource === 'settings') return DEFAULT_MAX_CHARS
  if (!runtimeBudget) return DEFAULT_MAX_CHARS

  const watermark = normalizeWatermark(
    settings?.contextWatermark ?? runtimeBudget.contextWatermark,
  )
  const charsPerToken = normalizeCharsPerToken(settings?.charsPerToken)
  return normalizeMaxChars(
    Math.floor(runtimeBudget.maxContextTokens * watermark * charsPerToken),
  )
}

export function formatContextPackForPrompt(pack: ContextPack): string {
  const lines = [
    '<context_pack>',
    `cwd: ${pack.cwd}`,
    `budget: ${pack.totalChars}/${pack.maxChars} chars`,
  ]

  for (const tier of ['hot', 'warm', 'cold'] as const) {
    const tierSections = pack.sections.filter(section => section.tier === tier)
    if (tierSections.length === 0) continue

    lines.push('', `<evidence_tier name="${tier}">`)
    for (const section of tierSections) {
      lines.push(
        '',
        `<section id="${section.id}" title="${section.title}" tier="${section.tier}" priority="${section.priority}">`,
        section.content,
        '</section>',
      )
    }
    lines.push(`</evidence_tier>`)
  }

  lines.push('</context_pack>')
  return lines.join('\n')
}

export function summarizeDiff(diff: string, maxLines = 80): string {
  const lines = diff.split(/\r?\n/).filter(line => line.trim().length > 0)
  const fileHeaders = lines.filter(line => line.startsWith('diff --git '))
  const statLines = lines.filter(
    line =>
      line.startsWith('+++ ') ||
      line.startsWith('--- ') ||
      line.startsWith('@@') ||
      line.startsWith('+') ||
      line.startsWith('-'),
  )
  const selected = [...fileHeaders, ...statLines].slice(0, maxLines)
  return selected.length > 0 ? selected.join('\n') : diff
}

function buildDraftSections(
  input: ContextPackInput,
  settings: ContextPackerSettings,
): DraftSection[] {
  if (!isContextPackerEnabled(settings)) return []

  const sections: DraftSection[] = []

  if (settings.includeVerification !== false && input.verificationSummary) {
    const content = formatVerificationSection(input.verificationSummary)
    if (content) {
      sections.push({
        id: 'verification',
        title: 'Verification',
        tier: 'hot',
        priority: 100,
        content,
      })
    }
  }

  if (settings.includeLsp !== false && input.lsp) {
    const content = formatLspSection(input.lsp)
    if (content) {
      sections.push({
        id: 'lsp',
        title: 'LSP',
        tier: 'hot',
        priority: 95,
        content,
      })
    }
  }

  if (input.taskPrompt?.trim()) {
    sections.push({
      id: 'task',
      title: 'Task',
      tier: 'hot',
      priority: 90,
      content: input.taskPrompt.trim(),
    })
  }

  if (
    settings.includeRepoMap !== false &&
    (input.repoMap?.trim() ||
      input.changedFiles?.length ||
      hasPackageScripts(input.packageScripts))
  ) {
    sections.push({
      id: 'repo_map',
      title: 'Repo Map',
      tier: 'cold',
      priority: 85,
      content: formatRepoMapSection(input),
    })
  }

  if (settings.includeDiff !== false && input.diff?.trim()) {
    sections.push({
      id: 'diff',
      title: 'Diff',
      tier: 'hot',
      priority: 75,
      content: summarizeDiff(input.diff),
    })
  }

  if (
    settings.includeRelatedFiles !== false &&
    (input.relatedFiles?.length || input.recentFiles?.length)
  ) {
    sections.push({
      id: 'related_files',
      title: 'Related Files',
      tier: 'warm',
      priority: 82,
      content: formatRelatedFilesSection(input),
    })
  }

  if (settings.includeTestHints !== false && input.testHints?.length) {
    sections.push({
      id: 'test_hints',
      title: 'Test Hints',
      tier: 'warm',
      priority: 70,
      content: input.testHints.map(hint => `- ${hint}`).join('\n'),
    })
  }

  return sections
}

function normalizeCharsPerToken(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CHARS_PER_TOKEN
}

function normalizeWatermark(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : 1
}

function hasPackageScripts(
  packageScripts: Record<string, string> | undefined,
): boolean {
  return packageScripts !== undefined && Object.keys(packageScripts).length > 0
}

function formatVerificationSection(summary: VerificationSummary): string {
  const lines = [
    `status: ${summary.status}`,
    `commands: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.timedOut} timed out`,
  ]

  const issues = summary.results.flatMap(result =>
    result.issues.map(issue => ({
      command: result.name,
      issue,
    })),
  )

  for (const { command, issue } of issues.slice(0, 12)) {
    const location = formatLocation(issue.filePath, issue.line, issue.column)
    lines.push(
      `- [${command}] ${issue.kind}${location ? ` ${location}` : ''}: ${issue.message}`,
    )
  }

  return lines.join('\n')
}

function formatRepoMapSection(input: ContextPackInput): string {
  const lines: string[] = []

  if (input.repoMap?.trim()) {
    lines.push(input.repoMap.trim())
  }

  if (input.changedFiles?.length) {
    lines.push(
      'changed_files:',
      ...input.changedFiles.map(filePath => `- ${filePath}`),
    )
  }

  if (input.packageScripts && Object.keys(input.packageScripts).length > 0) {
    lines.push(
      'package_scripts:',
      ...Object.entries(input.packageScripts).map(
        ([name, script]) => `- ${name}: ${script}`,
      ),
    )
  }

  return lines.join('\n')
}

function formatRelatedFilesSection(input: ContextPackInput): string {
  const lines: string[] = []

  if (input.relatedFiles?.length) {
    lines.push('related_files:')
    for (const file of input.relatedFiles) {
      lines.push(`- ${file.path}${file.reason ? ` (${file.reason})` : ''}`)
      if (file.excerpt?.trim()) {
        lines.push(indent(file.excerpt.trim()))
      }
    }
  }

  if (input.recentFiles?.length) {
    lines.push(
      'recent_files:',
      ...input.recentFiles.map(filePath => `- ${filePath}`),
    )
  }

  return lines.join('\n')
}

function formatLspSection(lsp: ContextPackLspContext): string {
  const lines: string[] = []

  if (lsp.diagnostics?.length) {
    lines.push('diagnostics:')
    for (const diagnostic of lsp.diagnostics) {
      const location = formatLocation(
        diagnostic.filePath,
        diagnostic.line,
        diagnostic.column,
      )
      const source = [diagnostic.source, diagnostic.code]
        .filter(Boolean)
        .join(' ')
      lines.push(
        `- ${diagnostic.severity ?? 'diagnostic'} ${location}${source ? ` (${source})` : ''}: ${diagnostic.message}`,
      )
    }
  }

  if (lsp.symbols?.length) {
    lines.push('symbols:')
    for (const symbol of lsp.symbols) {
      const location = formatLocation(symbol.filePath, symbol.line)
      const reason = symbol.reason ? ` (${symbol.reason})` : ''
      lines.push(
        `- ${symbol.kind ?? 'symbol'} ${symbol.name} ${location}${reason}`,
      )
    }
  }

  if (lsp.references?.length) {
    lines.push('references:')
    for (const reference of lsp.references) {
      const location = formatLocation(
        reference.filePath,
        reference.line,
        reference.column,
      )
      const reason = reference.reason ? ` (${reference.reason})` : ''
      lines.push(`- ${reference.symbol ?? 'reference'} ${location}${reason}`)
    }
  }

  return lines.join('\n')
}

function applyBudget(
  drafts: DraftSection[],
  maxChars: number,
): ContextPackSection[] {
  const ordered = drafts
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) =>
        TIER_RANK[b.section.tier] - TIER_RANK[a.section.tier] ||
        b.section.priority - a.section.priority ||
        a.index - b.index,
    )

  const sections: ContextPackSection[] = []
  let remaining = maxChars

  for (const { section } of ordered) {
    if (remaining <= 0) break

    const clipped = clipText(section.content, remaining)
    remaining -= clipped.text.length
    sections.push({
      ...section,
      content: clipped.text,
      charCount: clipped.text.length,
      truncated: clipped.truncated,
    })
  }

  return sections
}

function clipText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }
  if (maxChars <= TRUNCATION_MARKER.length) {
    return {
      text: TRUNCATION_MARKER.slice(0, maxChars),
      truncated: true,
    }
  }
  return {
    text: `${text.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`,
    truncated: true,
  }
}

function normalizeMaxChars(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return DEFAULT_MAX_CHARS
  }
  return Math.floor(value)
}

function formatLocation(
  filePath: string | undefined,
  line?: number,
  column?: number,
): string {
  if (!filePath) return ''
  if (line === undefined) return filePath
  if (column === undefined) return `${filePath}:${line}`
  return `${filePath}:${line}:${column}`
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `  ${line}`)
    .join('\n')
}
