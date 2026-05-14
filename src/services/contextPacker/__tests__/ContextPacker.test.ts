import { describe, expect, test } from 'bun:test'
import {
  ContextPacker,
  formatContextPackForPrompt,
  isContextPackerEnabled,
  summarizeDiff,
} from '../ContextPacker.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('ContextPacker', () => {
  test('builds structured sections from task evidence', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix the failing parser tests',
      repoMap: 'src/parser.ts\nsrc/parser.test.ts',
      changedFiles: ['src/parser.ts'],
      diff: sampleDiff(),
      verificationSummary: failedVerificationSummary(),
      relatedFiles: [
        {
          path: 'src/parser.test.ts',
          reason: 'nearest test',
          excerpt: 'test("parses input", () => {})',
        },
      ],
      recentFiles: ['src/tokenizer.ts'],
      testHints: ['Run bun test src/parser.test.ts'],
      lsp: {
        diagnostics: [
          {
            filePath: 'src/parser.ts',
            line: 12,
            column: 5,
            severity: 'error',
            message: 'Cannot find name Token',
          },
        ],
        symbols: [
          {
            filePath: 'src/parser.ts',
            name: 'parseInput',
            kind: 'nearest',
            line: 8,
            reason: 'lsp diagnostic',
          },
        ],
        references: [
          {
            filePath: 'src/parser.test.ts',
            symbol: 'parseInput',
            line: 14,
            reason: 'failing test',
          },
        ],
      },
      generatedAt: 123,
    })

    expect(pack).toMatchObject({
      cwd: '/repo',
      generatedAt: 123,
      truncated: false,
    })
    expect(pack.sections.map(section => section.id)).toEqual([
      'verification',
      'lsp',
      'task',
      'repo_map',
      'related_files',
      'diff',
      'test_hints',
    ])
    expect(
      pack.sections.find(section => section.id === 'verification')?.content,
    ).toContain('src/parser.ts:12:5')
    expect(
      pack.sections.find(section => section.id === 'lsp')?.content,
    ).toContain('nearest parseInput')
    expect(
      pack.sections.find(section => section.id === 'lsp')?.content,
    ).toContain('references:')
    expect(
      pack.sections.find(section => section.id === 'related_files')?.content,
    ).toContain('nearest test')
  })

  test('applies budget by keeping verification and LSP evidence first', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix important task '.repeat(80),
      verificationSummary: failedVerificationSummary(),
      lsp: {
        diagnostics: [
          {
            filePath: 'src/parser.ts',
            line: 12,
            column: 5,
            severity: 'Error',
            message: 'Type mismatch',
          },
        ],
      },
      diff: `diff --git a/huge.ts b/huge.ts\n${'+x\n'.repeat(200)}`,
      maxChars: 300,
    })

    expect(pack.truncated).toBe(true)
    expect(pack.totalChars).toBeLessThanOrEqual(300)
    expect(pack.sections.map(section => section.id)).toContain('verification')
    expect(pack.sections.map(section => section.id)).toContain('lsp')
    expect(pack.sections.map(section => section.id)).not.toContain('diff')
  })

  test('respects settings that disable optional sections', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix tests',
      repoMap: 'src/index.ts',
      diff: sampleDiff(),
      verificationSummary: failedVerificationSummary(),
      settings: {
        includeDiff: false,
        includeVerification: false,
        includeRepoMap: false,
      },
    })

    expect(pack.sections.map(section => section.id)).toEqual(['task'])
  })

  test('returns no sections when disabled', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix tests',
      settings: { enabled: false },
    })

    expect(pack.sections).toEqual([])
    expect(isContextPackerEnabled({ enabled: false })).toBe(false)
  })

  test('formats a model-readable context pack', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix tests',
      changedFiles: ['src/index.ts'],
      generatedAt: 123,
    })

    expect(formatContextPackForPrompt(pack)).toContain('<context_pack>')
    expect(formatContextPackForPrompt(pack)).toContain('<section id="repo_map"')
    expect(formatContextPackForPrompt(pack)).toContain('src/index.ts')
  })

  test('summarizes diff headers and changed lines', () => {
    expect(summarizeDiff(sampleDiff())).toContain('diff --git')
    expect(summarizeDiff(sampleDiff())).toContain('@@ -1,3 +1,3 @@')
    expect(summarizeDiff(sampleDiff())).toContain('+export const value = 2')
  })
})

function sampleDiff(): string {
  return [
    'diff --git a/src/index.ts b/src/index.ts',
    '--- a/src/index.ts',
    '+++ b/src/index.ts',
    '@@ -1,3 +1,3 @@',
    '-export const value = 1',
    '+export const value = 2',
  ].join('\n')
}

function failedVerificationSummary(): VerificationSummary {
  return {
    status: 'failed',
    total: 1,
    passed: 0,
    failed: 1,
    timedOut: 0,
    durationMs: 42,
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
    ],
  }
}
