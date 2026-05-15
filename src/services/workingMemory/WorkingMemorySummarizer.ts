import type { Message } from '../../types/message.js'
import {
  getAssistantMessageText,
  getUserMessageText,
} from '../../utils/messages.js'
import type {
  VerificationResult,
  VerificationSummary,
} from '../verification/index.js'
import type {
  WorkingMemoryCommand,
  WorkingMemoryFile,
  WorkingMemoryItem,
  WorkingMemoryPatch,
  WorkingMemoryVerificationStatus,
} from './WorkingMemoryStore.js'

export type WorkingMemorySummarizerInput = {
  messages?: Message[]
  verificationSummary?: VerificationSummary
  now?: number
}

export class WorkingMemorySummarizer {
  summarize(input: WorkingMemorySummarizerInput): WorkingMemoryPatch {
    return summarizeWorkingMemory(input)
  }
}

export function summarizeWorkingMemory({
  messages = [],
  verificationSummary,
  now = Date.now(),
}: WorkingMemorySummarizerInput): WorkingMemoryPatch {
  const patch: WorkingMemoryPatch = {
    updatedAt: now,
  }

  const goal = extractGoal(messages)
  if (goal) patch.goal = goal

  const changedFiles = extractChangedFiles(messages, now)
  if (changedFiles.length > 0) patch.changedFiles = changedFiles

  const assistantTexts = messages
    .map(message => getAssistantMessageText(message))
    .filter((text): text is string => Boolean(text?.trim()))

  const nextSteps = extractNextSteps(assistantTexts, now)
  if (nextSteps.length > 0) patch.nextSteps = nextSteps

  const rejectedHypotheses = extractRejectedHypotheses(assistantTexts, now)
  if (rejectedHypotheses.length > 0) {
    patch.rejectedHypotheses = rejectedHypotheses
  }

  if (verificationSummary) {
    patch.verificationStatus = summarizeVerificationStatus(
      verificationSummary,
      now,
    )
    patch.commands = summarizeVerificationCommands(verificationSummary, now)

    const verificationFacts = summarizeVerificationFacts(
      verificationSummary,
      now,
    )
    if (verificationFacts.length > 0) patch.facts = verificationFacts

    const verificationNextStep = summarizeVerificationNextStep(
      verificationSummary,
      now,
    )
    if (verificationNextStep) {
      patch.nextSteps = [...(patch.nextSteps ?? []), verificationNextStep]
    }

    const verificationFiles = summarizeVerificationFiles(
      verificationSummary,
      now,
    )
    if (verificationFiles.length > 0) {
      patch.changedFiles = [...(patch.changedFiles ?? []), ...verificationFiles]
    }
  }

  return patch
}

function extractGoal(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.type !== 'user' || message.isMeta) continue

    const text = getUserMessageText(message)?.trim()
    if (text) return clipText(text, 300)
  }

  return undefined
}

function extractChangedFiles(
  messages: Message[],
  updatedAt: number,
): WorkingMemoryFile[] {
  const files: WorkingMemoryFile[] = []

  for (const message of messages) {
    if (message.type !== 'attachment') continue
    const attachment = getAttachmentRecord(message)
    if (!attachment) continue
    const type = attachment?.type
    if (type !== 'edited_text_file' && type !== 'edited_image_file') continue

    const filename = valueAsString(attachment.filename)
    if (!filename) continue
    files.push({
      path: filename,
      reason:
        type === 'edited_text_file' ? 'edited text file' : 'edited image file',
      updatedAt,
    })
  }

  return files
}

function extractNextSteps(
  assistantTexts: string[],
  updatedAt: number,
): WorkingMemoryItem[] {
  return uniqueItems(
    assistantTexts.flatMap(text =>
      text
        .split(/\r?\n/)
        .map(line => normalizeListLine(line))
        .filter(Boolean)
        .filter(line => isNextStepLine(line))
        .map(text => ({ text, source: 'assistant', updatedAt })),
    ),
  )
}

function extractRejectedHypotheses(
  assistantTexts: string[],
  updatedAt: number,
): WorkingMemoryItem[] {
  return uniqueItems(
    assistantTexts.flatMap(text =>
      text
        .split(/\r?\n/)
        .map(line => normalizeListLine(line))
        .filter(Boolean)
        .filter(line => isRejectedHypothesisLine(line))
        .map(text => ({ text, source: 'assistant', updatedAt })),
    ),
  )
}

function summarizeVerificationStatus(
  summary: VerificationSummary,
  updatedAt: number,
): WorkingMemoryVerificationStatus {
  const firstIssue = firstVerificationIssue(summary)
  return {
    status: summary.status,
    summary: firstIssue
      ? `${summary.passed}/${summary.total} commands passed; ${formatIssue(firstIssue)}`
      : `${summary.passed}/${summary.total} commands passed`,
    command: firstFailedOrLastCommand(summary),
    updatedAt,
  }
}

function summarizeVerificationCommands(
  summary: VerificationSummary,
  updatedAt: number,
): WorkingMemoryCommand[] {
  return summary.results.map(result => ({
    command: formatCommand(result),
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: summarizeCommandResult(result),
    updatedAt,
  }))
}

function summarizeVerificationFacts(
  summary: VerificationSummary,
  updatedAt: number,
): WorkingMemoryItem[] {
  return uniqueItems(
    summary.results.flatMap(result =>
      result.issues.map(issue => ({
        text: formatIssue(issue),
        source: result.name,
        updatedAt,
      })),
    ),
  )
}

function summarizeVerificationNextStep(
  summary: VerificationSummary,
  updatedAt: number,
): WorkingMemoryItem | undefined {
  if (summary.status === 'passed') {
    return {
      text: 'Verification passed; continue only if requested scope remains.',
      source: 'verification',
      updatedAt,
    }
  }

  const firstIssue = firstVerificationIssue(summary)
  return {
    text: firstIssue
      ? `Fix verification failure: ${formatIssue(firstIssue)}`
      : 'Fix failing verification command before final response.',
    source: 'verification',
    updatedAt,
  }
}

function summarizeVerificationFiles(
  summary: VerificationSummary,
  updatedAt: number,
): WorkingMemoryFile[] {
  return summary.results.flatMap(result =>
    result.issues.flatMap(issue =>
      issue.filePath
        ? [
            {
              path: issue.filePath,
              reason: `${result.name} ${issue.kind} issue`,
              updatedAt,
            },
          ]
        : [],
    ),
  )
}

function summarizeCommandResult(result: VerificationResult): string {
  const issue = result.issues[0]
  if (issue) return formatIssue(issue)
  const keyLog = result.keyLogs[0]
  if (keyLog) return clipText(keyLog, 240)
  return `${result.name} ${result.status}`
}

function firstVerificationIssue(summary: VerificationSummary) {
  return summary.results.flatMap(result => result.issues)[0]
}

function firstFailedOrLastCommand(
  summary: VerificationSummary,
): string | undefined {
  const failed = summary.results.find(result => result.status !== 'passed')
  const result = failed ?? summary.results.at(-1)
  return result ? formatCommand(result) : undefined
}

function formatCommand(result: Pick<VerificationResult, 'command' | 'args'>) {
  return [result.command, ...result.args].join(' ')
}

function formatIssue(
  issue: NonNullable<VerificationResult['issues'][number]>,
): string {
  const location = [issue.filePath, issue.line, issue.column]
    .filter(value => value !== undefined && value !== '')
    .join(':')
  const prefix = [issue.kind, issue.code].filter(Boolean).join(' ')
  return [
    prefix,
    location ? `${location}:` : undefined,
    issue.testName ? `${issue.testName}:` : undefined,
    issue.message,
  ]
    .filter(Boolean)
    .join(' ')
}

function getAttachmentRecord(
  message: Message,
): Record<string, unknown> | undefined {
  const maybeAttachment = (message as { attachment?: unknown }).attachment
  return isRecord(maybeAttachment) ? maybeAttachment : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeListLine(line: string): string {
  return line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()
}

function isNextStepLine(line: string): boolean {
  return /^(next|todo|follow[- ]?up|建议下一步|下一步|待办|继续)\b/i.test(line)
}

function isRejectedHypothesisLine(line: string): boolean {
  return /(ruled out|not caused by|not the cause|not the issue|排除|不是.*原因|并非.*问题)/i.test(
    line,
  )
}

function uniqueItems(items: WorkingMemoryItem[]): WorkingMemoryItem[] {
  const seen = new Set<string>()
  const unique: WorkingMemoryItem[] = []

  for (const item of items) {
    const key = item.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  return unique
}

function clipText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`
}
