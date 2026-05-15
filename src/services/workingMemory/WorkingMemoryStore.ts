export type WorkingMemoryItem = {
  text: string
  source?: string
  updatedAt?: number
}

export type WorkingMemoryFile = {
  path: string
  reason?: string
  updatedAt?: number
}

export type WorkingMemoryCommandStatus =
  | 'unknown'
  | 'passed'
  | 'failed'
  | 'timed_out'

export type WorkingMemoryCommand = {
  command: string
  status?: WorkingMemoryCommandStatus
  exitCode?: number | null
  durationMs?: number
  summary?: string
  updatedAt?: number
}

export type WorkingMemoryVerificationStatus = {
  status: WorkingMemoryCommandStatus
  summary?: string
  command?: string
  updatedAt?: number
}

export type WorkingMemory = {
  goal?: string
  facts: WorkingMemoryItem[]
  rejectedHypotheses: WorkingMemoryItem[]
  changedFiles: WorkingMemoryFile[]
  commands: WorkingMemoryCommand[]
  verificationStatus?: WorkingMemoryVerificationStatus
  nextSteps: WorkingMemoryItem[]
  updatedAt: number
}

export type WorkingMemoryPatch = {
  goal?: string
  facts?: WorkingMemoryItemInput[]
  rejectedHypotheses?: WorkingMemoryItemInput[]
  changedFiles?: WorkingMemoryFileInput[]
  commands?: WorkingMemoryCommandInput[]
  verificationStatus?: WorkingMemoryVerificationStatus
  nextSteps?: WorkingMemoryItemInput[]
  updatedAt?: number
}

export type WorkingMemoryItemInput = string | WorkingMemoryItem
export type WorkingMemoryFileInput = string | WorkingMemoryFile
export type WorkingMemoryCommandInput = string | WorkingMemoryCommand

export type WorkingMemoryStoreOptions = {
  maxChars?: number
  now?: () => number
}

export type SerializedWorkingMemory = {
  text: string
  totalChars: number
  maxChars: number
  truncated: boolean
}

type MemorySection = {
  id: string
  title: string
  priority: number
  lines: string[]
}

const DEFAULT_MAX_CHARS = 12_000
const TRUNCATION_MARKER = '...[working memory truncated]...'

export class WorkingMemoryStore {
  private memory: WorkingMemory
  private readonly maxChars: number
  private readonly now: () => number

  constructor(
    initialMemory?: WorkingMemoryPatch | WorkingMemory,
    options: WorkingMemoryStoreOptions = {},
  ) {
    this.maxChars = normalizeMaxChars(options.maxChars)
    this.now = options.now ?? Date.now
    this.memory = createWorkingMemory(undefined, this.now())
    if (initialMemory) {
      this.memory = updateWorkingMemory(this.memory, initialMemory, {
        now: this.now(),
      })
    }
  }

  getSnapshot(): WorkingMemory {
    return cloneWorkingMemory(this.memory)
  }

  update(patch: WorkingMemoryPatch): WorkingMemory {
    this.memory = trimWorkingMemory(
      updateWorkingMemory(this.memory, patch, { now: this.now() }),
      this.maxChars,
    )
    return this.getSnapshot()
  }

  merge(memory: WorkingMemory | WorkingMemoryPatch): WorkingMemory {
    return this.update(memory)
  }

  serialize(maxChars = this.maxChars): SerializedWorkingMemory {
    return serializeWorkingMemory(this.memory, { maxChars })
  }

  trim(maxChars = this.maxChars): WorkingMemory {
    this.memory = trimWorkingMemory(this.memory, maxChars)
    return this.getSnapshot()
  }
}

export function createWorkingMemory(
  patch?: WorkingMemoryPatch,
  now = Date.now(),
): WorkingMemory {
  const empty: WorkingMemory = {
    facts: [],
    rejectedHypotheses: [],
    changedFiles: [],
    commands: [],
    nextSteps: [],
    updatedAt: now,
  }
  return patch ? updateWorkingMemory(empty, patch, { now }) : empty
}

export function updateWorkingMemory(
  memory: WorkingMemory,
  patch: WorkingMemoryPatch,
  options: { now?: number } = {},
): WorkingMemory {
  const updatedAt = patch.updatedAt ?? options.now ?? Date.now()
  const next: WorkingMemory = {
    goal: normalizeOptionalText(patch.goal) ?? memory.goal,
    facts: mergeItems(memory.facts, patch.facts, updatedAt),
    rejectedHypotheses: mergeItems(
      memory.rejectedHypotheses,
      patch.rejectedHypotheses,
      updatedAt,
    ),
    changedFiles: mergeFiles(
      memory.changedFiles,
      patch.changedFiles,
      updatedAt,
    ),
    commands: mergeCommands(memory.commands, patch.commands, updatedAt),
    verificationStatus: patch.verificationStatus ?? memory.verificationStatus,
    nextSteps: mergeItems(memory.nextSteps, patch.nextSteps, updatedAt),
    updatedAt,
  }

  if (
    next.verificationStatus &&
    next.verificationStatus.updatedAt === undefined
  ) {
    next.verificationStatus = {
      ...next.verificationStatus,
      updatedAt,
    }
  }

  return next
}

export function mergeWorkingMemory(
  base: WorkingMemory,
  incoming: WorkingMemory | WorkingMemoryPatch,
): WorkingMemory {
  return updateWorkingMemory(base, incoming, {
    now: incoming.updatedAt ?? base.updatedAt,
  })
}

export function serializeWorkingMemory(
  memory: WorkingMemory,
  options: { maxChars?: number } = {},
): SerializedWorkingMemory {
  const maxChars = normalizeMaxChars(options.maxChars)
  const fullText = renderSections(buildSections(memory))
  if (fullText.length <= maxChars) {
    return {
      text: fullText,
      totalChars: fullText.length,
      maxChars,
      truncated: false,
    }
  }

  const text = renderSections(
    applySectionBudget(buildSections(memory), maxChars),
  )
  return {
    text,
    totalChars: text.length,
    maxChars,
    truncated: true,
  }
}

export function trimWorkingMemory(
  memory: WorkingMemory,
  maxChars = DEFAULT_MAX_CHARS,
): WorkingMemory {
  const serialized = serializeWorkingMemory(memory, { maxChars })
  if (!serialized.truncated) return cloneWorkingMemory(memory)

  const keptSections = parseSerializedSections(serialized.text)
  return {
    goal: keptSections.goal ?? memory.goal,
    verificationStatus: keptSections.verificationStatus
      ? memory.verificationStatus
      : undefined,
    nextSteps: filterItemsByRenderedLines(
      memory.nextSteps,
      keptSections.nextSteps,
    ),
    changedFiles: filterFilesByRenderedLines(
      memory.changedFiles,
      keptSections.changedFiles,
    ),
    commands: filterCommandsByRenderedLines(
      memory.commands,
      keptSections.commands,
    ),
    facts: filterItemsByRenderedLines(memory.facts, keptSections.facts),
    rejectedHypotheses: filterItemsByRenderedLines(
      memory.rejectedHypotheses,
      keptSections.rejectedHypotheses,
    ),
    updatedAt: memory.updatedAt,
  }
}

function buildSections(memory: WorkingMemory): MemorySection[] {
  const sections: MemorySection[] = []

  if (memory.goal) {
    sections.push({
      id: 'goal',
      title: 'Goal',
      priority: 100,
      lines: [memory.goal],
    })
  }

  if (memory.verificationStatus) {
    sections.push({
      id: 'verificationStatus',
      title: 'Verification Status',
      priority: 95,
      lines: [formatVerificationStatus(memory.verificationStatus)],
    })
  }

  addListSection(sections, {
    id: 'nextSteps',
    title: 'Next Steps',
    priority: 90,
    lines: memory.nextSteps.map(formatItem),
  })
  addListSection(sections, {
    id: 'changedFiles',
    title: 'Changed Files',
    priority: 85,
    lines: memory.changedFiles.map(formatFile),
  })
  addListSection(sections, {
    id: 'commands',
    title: 'Commands',
    priority: 80,
    lines: memory.commands.map(formatCommand),
  })
  addListSection(sections, {
    id: 'facts',
    title: 'Facts',
    priority: 70,
    lines: memory.facts.map(formatItem),
  })
  addListSection(sections, {
    id: 'rejectedHypotheses',
    title: 'Rejected Hypotheses',
    priority: 60,
    lines: memory.rejectedHypotheses.map(formatItem),
  })

  return sections
}

function addListSection(
  sections: MemorySection[],
  section: MemorySection,
): void {
  if (section.lines.length > 0) sections.push(section)
}

function applySectionBudget(
  sections: MemorySection[],
  maxChars: number,
): MemorySection[] {
  const ordered = sections
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) => b.section.priority - a.section.priority || a.index - b.index,
    )

  const kept: MemorySection[] = []
  let current = ''

  for (const { section } of ordered) {
    const lines: string[] = []
    for (const line of section.lines) {
      const candidateSection = { ...section, lines: [...lines, line] }
      const candidate = renderSections([...kept, candidateSection])
      if (candidate.length > maxChars) break
      lines.push(line)
      current = candidate
    }

    if (lines.length > 0) {
      kept.push({ ...section, lines })
    }
  }

  const withMarker = `${current}\n\n${TRUNCATION_MARKER}`.trim()
  if (withMarker.length <= maxChars) {
    kept.push({
      id: 'truncated',
      title: 'Truncated',
      priority: 0,
      lines: [TRUNCATION_MARKER],
    })
  }

  return kept.sort(
    (a, b) => sectionDisplayOrder(a.id) - sectionDisplayOrder(b.id),
  )
}

function renderSections(sections: MemorySection[]): string {
  return sections
    .map(section => [`## ${section.title}`, ...section.lines].join('\n'))
    .join('\n\n')
}

function parseSerializedSections(text: string): Record<string, string[]> & {
  goal?: string
  verificationStatus?: string[]
} {
  const parsed: Record<string, string[]> & {
    goal?: string
    verificationStatus?: string[]
  } = {}
  let currentId: string | undefined

  for (const line of text.split(/\r?\n/)) {
    const sectionId = idForTitle(line.replace(/^##\s*/, ''))
    if (line.startsWith('## ') && sectionId) {
      currentId = sectionId
      parsed[currentId] = []
      continue
    }
    if (!currentId || line === TRUNCATION_MARKER || line.trim() === '') continue
    parsed[currentId]?.push(line)
  }

  if (parsed.goal?.[0]) parsed.goal = parsed.goal[0]
  return parsed
}

function idForTitle(title: string): string | undefined {
  switch (title) {
    case 'Goal':
      return 'goal'
    case 'Verification Status':
      return 'verificationStatus'
    case 'Next Steps':
      return 'nextSteps'
    case 'Changed Files':
      return 'changedFiles'
    case 'Commands':
      return 'commands'
    case 'Facts':
      return 'facts'
    case 'Rejected Hypotheses':
      return 'rejectedHypotheses'
    default:
      return undefined
  }
}

function sectionDisplayOrder(id: string): number {
  return [
    'goal',
    'verificationStatus',
    'nextSteps',
    'changedFiles',
    'commands',
    'facts',
    'rejectedHypotheses',
    'truncated',
  ].indexOf(id)
}

function mergeItems(
  existing: WorkingMemoryItem[],
  incoming: WorkingMemoryItemInput[] | undefined,
  updatedAt: number,
): WorkingMemoryItem[] {
  if (!incoming?.length) return existing.map(item => ({ ...item }))

  const byText = new Map(
    existing.map(item => [normalizeKey(item.text), { ...item }]),
  )

  for (const input of incoming) {
    const item = normalizeItem(input, updatedAt)
    if (!item) continue
    byText.set(normalizeKey(item.text), {
      ...byText.get(normalizeKey(item.text)),
      ...item,
    })
  }

  return Array.from(byText.values())
}

function mergeFiles(
  existing: WorkingMemoryFile[],
  incoming: WorkingMemoryFileInput[] | undefined,
  updatedAt: number,
): WorkingMemoryFile[] {
  if (!incoming?.length) return existing.map(file => ({ ...file }))

  const byPath = new Map(existing.map(file => [file.path, { ...file }]))
  for (const input of incoming) {
    const file = normalizeFile(input, updatedAt)
    if (!file) continue
    const existingFile = byPath.get(file.path)
    byPath.set(file.path, {
      ...existingFile,
      ...file,
      reason: mergeText(existingFile?.reason, file.reason),
    })
  }

  return Array.from(byPath.values())
}

function mergeCommands(
  existing: WorkingMemoryCommand[],
  incoming: WorkingMemoryCommandInput[] | undefined,
  updatedAt: number,
): WorkingMemoryCommand[] {
  if (!incoming?.length) return existing.map(command => ({ ...command }))

  const byCommand = new Map(
    existing.map(command => [command.command, { ...command }]),
  )
  for (const input of incoming) {
    const command = normalizeCommand(input, updatedAt)
    if (!command) continue
    byCommand.set(command.command, {
      ...byCommand.get(command.command),
      ...command,
    })
  }

  return Array.from(byCommand.values())
}

function normalizeItem(
  input: WorkingMemoryItemInput,
  updatedAt: number,
): WorkingMemoryItem | undefined {
  const item = typeof input === 'string' ? { text: input } : input
  const text = normalizeOptionalText(item.text)
  if (!text) return undefined
  return {
    ...item,
    text,
    updatedAt: item.updatedAt ?? updatedAt,
  }
}

function normalizeFile(
  input: WorkingMemoryFileInput,
  updatedAt: number,
): WorkingMemoryFile | undefined {
  const file = typeof input === 'string' ? { path: input } : input
  const path = normalizeOptionalText(file.path)
  if (!path) return undefined
  return {
    ...file,
    path,
    updatedAt: file.updatedAt ?? updatedAt,
  }
}

function normalizeCommand(
  input: WorkingMemoryCommandInput,
  updatedAt: number,
): WorkingMemoryCommand | undefined {
  const command = typeof input === 'string' ? { command: input } : input
  const commandText = normalizeOptionalText(command.command)
  if (!commandText) return undefined
  return {
    ...command,
    command: commandText,
    status: command.status ?? 'unknown',
    updatedAt: command.updatedAt ?? updatedAt,
  }
}

function normalizeOptionalText(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, ' ').trim()
  return normalized ? normalized : undefined
}

function normalizeKey(text: string): string {
  return text.toLowerCase()
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (!Number.isFinite(maxChars) || maxChars === undefined || maxChars <= 0) {
    return DEFAULT_MAX_CHARS
  }
  return Math.floor(maxChars)
}

function cloneWorkingMemory(memory: WorkingMemory): WorkingMemory {
  return {
    ...memory,
    facts: memory.facts.map(item => ({ ...item })),
    rejectedHypotheses: memory.rejectedHypotheses.map(item => ({ ...item })),
    changedFiles: memory.changedFiles.map(file => ({ ...file })),
    commands: memory.commands.map(command => ({ ...command })),
    verificationStatus: memory.verificationStatus
      ? { ...memory.verificationStatus }
      : undefined,
    nextSteps: memory.nextSteps.map(item => ({ ...item })),
  }
}

function formatItem(item: WorkingMemoryItem): string {
  return `- ${item.text}${item.source ? ` (${item.source})` : ''}`
}

function formatFile(file: WorkingMemoryFile): string {
  return `- ${file.path}${file.reason ? ` (${file.reason})` : ''}`
}

function formatCommand(command: WorkingMemoryCommand): string {
  const parts = [`- ${command.command}`]
  if (command.status) parts.push(`[${command.status}]`)
  if (command.exitCode !== undefined) parts.push(`exit=${command.exitCode}`)
  if (command.durationMs !== undefined) parts.push(`${command.durationMs}ms`)
  if (command.summary) parts.push(`- ${command.summary}`)
  return parts.join(' ')
}

function formatVerificationStatus(
  status: WorkingMemoryVerificationStatus,
): string {
  return [
    status.status,
    status.command ? `command=${status.command}` : undefined,
    status.summary,
  ]
    .filter(Boolean)
    .join(' - ')
}

function mergeText(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  if (!first) return second
  if (!second || first === second) return first
  return `${first}; ${second}`
}

function filterItemsByRenderedLines(
  items: WorkingMemoryItem[],
  lines: string[] | undefined,
): WorkingMemoryItem[] {
  if (!lines) return []
  const kept = new Set(lines)
  return items.filter(item => kept.has(formatItem(item)))
}

function filterFilesByRenderedLines(
  files: WorkingMemoryFile[],
  lines: string[] | undefined,
): WorkingMemoryFile[] {
  if (!lines) return []
  const kept = new Set(lines)
  return files.filter(file => kept.has(formatFile(file)))
}

function filterCommandsByRenderedLines(
  commands: WorkingMemoryCommand[],
  lines: string[] | undefined,
): WorkingMemoryCommand[] {
  if (!lines) return []
  const kept = new Set(lines)
  return commands.filter(command => kept.has(formatCommand(command)))
}
