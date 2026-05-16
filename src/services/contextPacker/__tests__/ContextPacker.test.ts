import { describe, expect, test } from 'bun:test'
import {
  ContextPacker,
  formatContextPackForPrompt,
  isContextPackerEnabled,
  resolveContextPackMaxChars,
  shouldInjectContextPackForQuery,
  summarizeDiff,
} from '../ContextPacker.js'
import type { VerificationSummary } from '../../verification/index.js'
import { createUserMessage } from '../../../utils/messages.js'

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
      'diff',
      'related_files',
      'test_hints',
      'repo_map',
    ])
    expect(pack.sections.map(section => section.tier)).toEqual([
      'hot',
      'hot',
      'hot',
      'hot',
      'warm',
      'warm',
      'cold',
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

  test('keeps verification text from prior query metadata', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix verification',
      verificationText:
        '<verification_result>\nstatus: failed\nsrc/index.ts(1,1): error\n</verification_result>',
    })

    expect(pack.sections.map(section => section.id)).toContain('verification')
    expect(
      pack.sections.find(section => section.id === 'verification')?.content,
    ).toContain('status: failed')
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
    expect(formatContextPackForPrompt(pack)).toContain(
      '<evidence_tier name="hot">',
    )
    expect(formatContextPackForPrompt(pack)).toContain(
      '<evidence_tier name="cold">',
    )
    expect(formatContextPackForPrompt(pack)).toContain(
      '<section id="repo_map" title="Repo Map" tier="cold"',
    )
    expect(formatContextPackForPrompt(pack)).toContain('src/index.ts')
  })

  test('keeps hot evidence before warm and cold evidence under budget', () => {
    const pack = new ContextPacker().pack({
      cwd: '/repo',
      taskPrompt: 'Fix parser',
      changedFiles: ['src/parser.ts'],
      repoMap: 'src/parser.ts\n'.repeat(100),
      relatedFiles: [
        {
          path: 'src/parser.ts',
          reason: 'current target',
          excerpt: 'export const parser = true\n'.repeat(40),
        },
      ],
      maxChars: 300,
    })

    expect(pack.truncated).toBe(true)
    expect(pack.sections.map(section => section.tier)).toEqual(['hot', 'warm'])
    expect(pack.sections.map(section => section.id)).not.toContain('repo_map')
  })

  test('summarizes diff headers and changed lines', () => {
    expect(summarizeDiff(sampleDiff())).toContain('diff --git')
    expect(summarizeDiff(sampleDiff())).toContain('@@ -1,3 +1,3 @@')
    expect(summarizeDiff(sampleDiff())).toContain('+export const value = 2')
  })

  test('derives pack budget from the active model context profile', () => {
    expect(
      resolveContextPackMaxChars(
        { enabled: true },
        {
          maxContextTokens: 800_000,
          contextWatermark: 0.8,
          source: 'deepseek-v4-pro:max',
        },
      ),
    ).toBe(2_560_000)
  })

  test('lets explicit settings override model-profile pack budget', () => {
    expect(
      resolveContextPackMaxChars(
        {
          enabled: true,
          maxChars: 120_000,
        },
        {
          maxContextTokens: 800_000,
          contextWatermark: 0.8,
          source: 'deepseek-v4-pro:max',
        },
      ),
    ).toBe(120_000)
  })

  test('can force legacy settings budget instead of model-profile budget', () => {
    expect(
      resolveContextPackMaxChars(
        {
          enabled: true,
          budgetSource: 'settings',
        },
        {
          maxContextTokens: 800_000,
          contextWatermark: 0.8,
          source: 'deepseek-v4-pro:max',
        },
      ),
    ).toBe(24_000)
  })

  test('auto-injects for DeepSeek V4 Pro high and max effort', () => {
    const messages = [createUserMessage({ content: 'fix the parser' })]

    expect(
      shouldInjectContextPackForQuery({
        messages,
        model: 'deepseek-v4-pro',
        effortValue: 'high',
      }),
    ).toEqual({ shouldInject: true, reason: 'deepseek-v4-pro-high' })

    expect(
      shouldInjectContextPackForQuery({
        messages,
        model: 'deepseek-v4-pro',
        effortValue: 'max',
      }),
    ).toEqual({ shouldInject: true, reason: 'deepseek-v4-pro-max' })
  })

  test('does not auto-inject for ordinary short non-DeepSeek tasks', () => {
    expect(
      shouldInjectContextPackForQuery({
        messages: [createUserMessage({ content: 'say hi' })],
        model: 'claude-sonnet-4-5-20250929',
      }),
    ).toEqual({ shouldInject: false })
  })

  test('does not auto-inject for DeepSeek V4 Pro short tasks without an explicit high or max effort', () => {
    expect(
      shouldInjectContextPackForQuery({
        messages: [createUserMessage({ content: 'say hi' })],
        model: 'deepseek-v4-pro',
      }),
    ).toEqual({ shouldInject: false })
  })

  test('auto-injects for long prompts and tool-heavy chains', () => {
    expect(
      shouldInjectContextPackForQuery({
        messages: [createUserMessage({ content: 'x'.repeat(1_201) })],
        model: 'claude-sonnet-4-5-20250929',
      }),
    ).toEqual({ shouldInject: true, reason: 'long-task' })

    expect(
      shouldInjectContextPackForQuery({
        messages: [
          createUserMessage({
            content: Array.from({ length: 6 }, (_, index) => ({
              type: 'tool_result' as const,
              tool_use_id: `toolu_${index}`,
              content: `result ${index}`,
            })),
          }),
        ],
        model: 'claude-sonnet-4-5-20250929',
      }),
    ).toEqual({ shouldInject: true, reason: 'tool-chain' })
  })

  test('explicit disable wins over automatic triggers', () => {
    expect(
      shouldInjectContextPackForQuery({
        messages: [createUserMessage({ content: 'x'.repeat(5_000) })],
        settings: { enabled: false },
        model: 'deepseek-v4-pro',
        effortValue: 'max',
      }),
    ).toEqual({ shouldInject: false })
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
