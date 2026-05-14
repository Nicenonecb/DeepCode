import { describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import { createAttachmentMessage } from '../../../utils/attachments.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import type { VerificationSummary } from '../../verification/index.js'
import {
  WorkingMemorySummarizer,
  summarizeWorkingMemory,
} from '../WorkingMemorySummarizer.js'

describe('WorkingMemorySummarizer', () => {
  test('extracts user goal, edited files, assistant next steps, and rejected hypotheses', () => {
    const patch = summarizeWorkingMemory({
      messages: [
        createUserMessage({
          content: 'Fix parser test failures and keep scope small.',
        }),
        createAttachmentMessage({
          type: 'edited_text_file',
          filename: 'src/parser.ts',
          snippet: '1  export function parse() {}',
        }),
        createAttachmentMessage({
          type: 'edited_image_file',
          filename: 'docs/parser.png',
          content: {
            type: 'text',
            file: {
              filePath: 'docs/parser.png',
              content: 'image',
              numLines: 1,
              startLine: 1,
              totalLines: 1,
            },
          },
        }),
        createAssistantMessage({
          content: [
            'Ruled out lexer output as the cause.',
            'Next: patch parser branch.',
            '- todo run focused parser test',
          ].join('\n'),
        }),
      ] as Message[],
      now: 123,
    })

    expect(patch.goal).toBe('Fix parser test failures and keep scope small.')
    expect(patch.changedFiles).toEqual([
      {
        path: 'src/parser.ts',
        reason: 'edited text file',
        updatedAt: 123,
      },
      {
        path: 'docs/parser.png',
        reason: 'edited image file',
        updatedAt: 123,
      },
    ])
    expect(patch.rejectedHypotheses).toEqual([
      {
        text: 'Ruled out lexer output as the cause.',
        source: 'assistant',
        updatedAt: 123,
      },
    ])
    expect(patch.nextSteps).toEqual([
      {
        text: 'Next: patch parser branch.',
        source: 'assistant',
        updatedAt: 123,
      },
      {
        text: 'todo run focused parser test',
        source: 'assistant',
        updatedAt: 123,
      },
    ])
  })

  test('skips meta user messages when extracting goal', () => {
    const patch = summarizeWorkingMemory({
      messages: [
        createUserMessage({
          content: '<verification_result>failed</verification_result>',
          isMeta: true,
        }),
        createUserMessage({
          content: 'Implement working memory summarizer.',
        }),
      ] as Message[],
      now: 123,
    })

    expect(patch.goal).toBe('Implement working memory summarizer.')
  })

  test('extracts verification commands, status, facts, files, and next step', () => {
    const patch = summarizeWorkingMemory({
      messages: [
        createUserMessage({
          content: 'Fix parser',
        }),
      ] as Message[],
      verificationSummary: failedVerificationSummary(),
      now: 200,
    })

    expect(patch.verificationStatus).toEqual({
      status: 'failed',
      command: 'bun run typecheck',
      summary:
        '0/2 commands passed; typescript TS2304 src/parser.ts:12:5: Cannot find name Token',
      updatedAt: 200,
    })
    expect(patch.commands).toEqual([
      {
        command: 'bun run typecheck',
        status: 'failed',
        exitCode: 2,
        durationMs: 42,
        summary: 'typescript TS2304 src/parser.ts:12:5: Cannot find name Token',
        updatedAt: 200,
      },
      {
        command: 'bun test src/parser.test.ts',
        status: 'failed',
        exitCode: 1,
        durationMs: 50,
        summary:
          'test src/parser.test.ts:8:3: parser > rejects bad input: Expected parse error',
        updatedAt: 200,
      },
    ])
    expect(patch.facts).toEqual([
      {
        text: 'typescript TS2304 src/parser.ts:12:5: Cannot find name Token',
        source: 'Typecheck',
        updatedAt: 200,
      },
      {
        text: 'test src/parser.test.ts:8:3: parser > rejects bad input: Expected parse error',
        source: 'Test',
        updatedAt: 200,
      },
    ])
    expect(patch.changedFiles).toEqual([
      {
        path: 'src/parser.ts',
        reason: 'Typecheck typescript issue',
        updatedAt: 200,
      },
      {
        path: 'src/parser.test.ts',
        reason: 'Test test issue',
        updatedAt: 200,
      },
    ])
    expect(patch.nextSteps).toContainEqual({
      text: 'Fix verification failure: typescript TS2304 src/parser.ts:12:5: Cannot find name Token',
      source: 'verification',
      updatedAt: 200,
    })
  })

  test('summarizes passed verification as a completion fact', () => {
    const patch = new WorkingMemorySummarizer().summarize({
      verificationSummary: passedVerificationSummary(),
      now: 300,
    })

    expect(patch.verificationStatus).toEqual({
      status: 'passed',
      command: 'bun test',
      summary: '1/1 commands passed',
      updatedAt: 300,
    })
    expect(patch.commands).toEqual([
      {
        command: 'bun test',
        status: 'passed',
        exitCode: 0,
        durationMs: 12,
        summary: 'Test passed',
        updatedAt: 300,
      },
    ])
    expect(patch.nextSteps).toEqual([
      {
        text: 'Verification passed; continue only if requested scope remains.',
        source: 'verification',
        updatedAt: 300,
      },
    ])
  })
})

function failedVerificationSummary(): VerificationSummary {
  return {
    status: 'failed',
    total: 2,
    passed: 0,
    failed: 2,
    timedOut: 0,
    durationMs: 92,
    results: [
      {
        kind: 'typecheck',
        name: 'Typecheck',
        command: 'bun',
        args: ['run', 'typecheck'],
        cwd: '/repo',
        timeoutMs: 1000,
        status: 'failed',
        exitCode: 2,
        durationMs: 42,
        stdout: '',
        stderr: 'src/parser.ts(12,5): error TS2304',
        stdoutTruncated: false,
        stderrTruncated: false,
        issues: [
          {
            kind: 'typescript',
            filePath: 'src/parser.ts',
            line: 12,
            column: 5,
            code: 'TS2304',
            message: 'Cannot find name Token',
          },
        ],
        keyLogs: ['src/parser.ts(12,5): error TS2304'],
      },
      {
        kind: 'test',
        name: 'Test',
        command: 'bun',
        args: ['test', 'src/parser.test.ts'],
        cwd: '/repo',
        timeoutMs: 1000,
        status: 'failed',
        exitCode: 1,
        durationMs: 50,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        issues: [
          {
            kind: 'test',
            filePath: 'src/parser.test.ts',
            line: 8,
            column: 3,
            testName: 'parser > rejects bad input',
            message: 'Expected parse error',
          },
        ],
        keyLogs: ['parser > rejects bad input'],
      },
    ],
  }
}

function passedVerificationSummary(): VerificationSummary {
  return {
    status: 'passed',
    total: 1,
    passed: 1,
    failed: 0,
    timedOut: 0,
    durationMs: 12,
    results: [
      {
        kind: 'test',
        name: 'Test',
        command: 'bun',
        args: ['test'],
        cwd: '/repo',
        timeoutMs: 1000,
        status: 'passed',
        exitCode: 0,
        durationMs: 12,
        stdout: 'ok',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        issues: [],
        keyLogs: [],
      },
    ],
  }
}
