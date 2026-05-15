import { describe, expect, test } from 'bun:test'
import {
  collectContextPackInput,
  collectContentDiffEvidence,
  collectGitEvidence,
  collectLspEvidence,
  collectPackageScripts,
  collectVerificationEvidence,
  findRelatedTestFiles,
  type GitEvidenceExecutor,
} from '../ContextCollectors.js'
import type { VerificationSummary } from '../../verification/index.js'

describe('ContextCollectors', () => {
  test('collects git diff and changed files with injected git executor', async () => {
    const calls: string[][] = []
    const gitExecutor: GitEvidenceExecutor = async args => {
      calls.push(args)
      if (args.includes('diff') && !args.includes('--name-only')) {
        return {
          code: 0,
          stdout:
            'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new',
        }
      }
      if (args.includes('--name-only')) {
        return { code: 0, stdout: 'src/foo.ts\n' }
      }
      return { code: 0, stdout: 'src/new.ts\n' }
    }

    await expect(
      collectGitEvidence({ cwd: '/repo', gitExecutor }),
    ).resolves.toEqual({
      diff: 'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new',
      changedFiles: ['src/foo.ts', 'src/new.ts'],
    })
    expect(calls.length).toBe(3)
  })

  test('reads package scripts and tolerates missing package json', async () => {
    await expect(
      collectPackageScripts({
        cwd: '/repo',
        readTextFile: async () =>
          JSON.stringify({
            scripts: {
              typecheck: 'tsc --noEmit',
              test: 'bun test',
            },
          }),
      }),
    ).resolves.toEqual({
      typecheck: 'tsc --noEmit',
      test: 'bun test',
    })

    await expect(
      collectPackageScripts({
        cwd: '/repo',
        readTextFile: async () => {
          throw new Error('missing')
        },
      }),
    ).resolves.toEqual({})
  })

  test('builds content diff evidence with shared diff utilities', () => {
    expect(
      collectContentDiffEvidence({
        filePath: 'src/foo.ts',
        oldContent: 'export const value = 1\n',
        newContent: 'export const value = 2\n',
      }),
    ).toEqual({
      changedFiles: ['src/foo.ts'],
      diff: [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,1 +1,1 @@',
        '-export const value = 1',
        '+export const value = 2',
      ].join('\n'),
    })
  })

  test('finds related tests for changed source and changed test files', () => {
    expect(
      findRelatedTestFiles(
        ['src/parser.ts', 'src/button.test.tsx'],
        [
          'src/parser.test.ts',
          'src/parser.spec.ts',
          'src/button.test.tsx',
          'src/other.test.ts',
        ],
      ),
    ).toEqual([
      'src/parser.test.ts',
      'src/parser.spec.ts',
      'src/button.test.tsx',
    ])
  })

  test('adapts verification summary to related files and test hints', () => {
    expect(collectVerificationEvidence(failedVerificationSummary())).toEqual({
      relatedFiles: [
        {
          path: 'src/parser.test.ts',
          reason: 'Test test issue',
        },
      ],
      testHints: [
        'Failing test: parser > rejects bad input',
        'Verification is failing; preserve error files first.',
      ],
    })
  })

  test('collects targeted LSP diagnostics and nearest symbols', () => {
    const evidence = collectLspEvidence({
      cwd: '/repo',
      changedFiles: ['src/parser.ts'],
      verificationSummary: mixedFailureSummary(),
      diagnosticProvider: () => [
        {
          serverName: 'typescript-language-server',
          files: [
            {
              uri: 'file:///repo/src/parser.ts',
              diagnostics: [
                {
                  message: 'Type "number" is not assignable to type "Token"',
                  severity: 'Error',
                  range: {
                    start: { line: 11, character: 9 },
                    end: { line: 11, character: 14 },
                  },
                  source: 'tsserver',
                  code: 'TS2322',
                },
                {
                  message: 'Prefer const assertion',
                  severity: 'Hint',
                  range: {
                    start: { line: 20, character: 2 },
                    end: { line: 20, character: 8 },
                  },
                },
              ],
            },
            {
              uri: 'file:///repo/src/unrelated.ts',
              diagnostics: [
                {
                  message: 'Should be ignored',
                  severity: 'Error',
                  range: {
                    start: { line: 1, character: 1 },
                    end: { line: 1, character: 2 },
                  },
                },
              ],
            },
          ],
        },
      ],
      symbolAtPosition: (_filePath, line) => {
        if (line === 11) return 'parseInput'
        if (line === 20) return 'tokenStream'
        if (line === 7) return 'parseInput'
        return null
      },
    })

    expect(evidence.relatedFiles).toEqual([
      {
        path: 'src/parser.ts',
        reason: 'lsp diagnostic',
      },
    ])
    expect(
      evidence.lsp.diagnostics?.map(diagnostic => diagnostic.message),
    ).toEqual([
      'Type "number" is not assignable to type "Token"',
      'Prefer const assertion',
    ])
    expect(evidence.lsp.symbols).toEqual([
      {
        filePath: 'src/parser.ts',
        name: 'parseInput',
        kind: 'nearest',
        line: 12,
        column: 10,
        reason: 'lsp diagnostic',
      },
      {
        filePath: 'src/parser.ts',
        name: 'tokenStream',
        kind: 'nearest',
        line: 21,
        column: 3,
        reason: 'lsp diagnostic',
      },
      {
        filePath: 'src/parser.ts',
        name: 'parseInput',
        kind: 'nearest',
        line: 12,
        column: 5,
        reason: 'typescript issue',
      },
      {
        filePath: 'src/parser.test.ts',
        name: 'parseInput',
        kind: 'nearest',
        line: 8,
        column: 3,
        reason: 'test issue',
      },
    ])
  })

  test('builds ContextPackInput from collectors', async () => {
    const input = await collectContextPackInput({
      cwd: '/repo',
      taskPrompt: 'Fix parser',
      verificationSummary: mixedFailureSummary(),
      gitExecutor: async args => {
        if (args.includes('diff') && !args.includes('--name-only')) {
          return {
            code: 0,
            stdout: 'diff --git a/src/parser.ts b/src/parser.ts',
          }
        }
        if (args.includes('--name-only')) {
          return { code: 0, stdout: 'src/parser.ts\n' }
        }
        return { code: 0, stdout: '' }
      },
      fileLister: async () => ['src/parser.test.ts', 'src/parser.ts'],
      readTextFile: async () =>
        JSON.stringify({
          scripts: {
            typecheck: 'tsc --noEmit',
            'test:all': 'bun test',
          },
        }),
      lspDiagnosticProvider: () => [
        {
          serverName: 'eslint',
          files: [
            {
              uri: 'file:///repo/src/parser.ts',
              diagnostics: [
                {
                  message: 'Unexpected any',
                  severity: 'Warning',
                  range: {
                    start: { line: 4, character: 11 },
                    end: { line: 4, character: 14 },
                  },
                  source: 'eslint',
                },
              ],
            },
          ],
        },
      ],
      symbolAtPosition: () => 'parseInput',
    })

    expect(input).toMatchObject({
      cwd: '/repo',
      taskPrompt: 'Fix parser',
      diff: 'diff --git a/src/parser.ts b/src/parser.ts',
      changedFiles: ['src/parser.ts'],
      packageScripts: {
        typecheck: 'tsc --noEmit',
        'test:all': 'bun test',
      },
    })
    expect(input.relatedFiles).toContainEqual({
      path: 'src/parser.test.ts',
      reason: 'related test; Test test issue',
    })
    expect(input.testHints).toContain('Detected verifier: bun run typecheck')
    expect(input.testHints).toContain('Detected verifier: bun run test:all')
    expect(input.testHints).toContain(
      'Failing test: parser > rejects bad input',
    )
    expect(input.testHints).toContain(
      'Verification is failing; preserve error files first.',
    )
    expect(input.relatedFiles).toContainEqual({
      path: 'src/parser.ts',
      reason: 'Typecheck typescript issue; Lint lint issue; lsp diagnostic',
      excerpt: undefined,
    })
    expect(input.relatedFiles).toContainEqual({
      path: 'src/parser.test.ts',
      reason: 'related test; Test test issue',
      excerpt: undefined,
    })
    expect(input.lsp?.diagnostics?.[0]?.filePath).toBe('src/parser.ts')
    expect(input.lsp?.diagnostics?.[0]?.message).toBe('Unexpected any')
    expect(input.lsp?.symbols?.[0]?.name).toBe('parseInput')
  })
})

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
        kind: 'test',
        name: 'Test',
        command: 'bun',
        args: ['test'],
        cwd: '/repo',
        timeoutMs: 1000,
        status: 'failed',
        exitCode: 1,
        durationMs: 42,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        issues: [
          {
            kind: 'test',
            filePath: 'src/parser.test.ts',
            testName: 'parser > rejects bad input',
            message: 'Expected parse error',
          },
        ],
        keyLogs: [],
      },
    ],
  }
}

function mixedFailureSummary(): VerificationSummary {
  return {
    status: 'failed',
    total: 3,
    passed: 0,
    failed: 3,
    timedOut: 0,
    durationMs: 120,
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
        stderr: 'src/parser.ts(12,5): error TS2322',
        stdoutTruncated: false,
        stderrTruncated: false,
        issues: [
          {
            kind: 'typescript',
            filePath: 'src/parser.ts',
            line: 12,
            column: 5,
            code: 'TS2322',
            message: 'Type mismatch',
          },
        ],
        keyLogs: ['src/parser.ts(12,5): error TS2322'],
      },
      {
        kind: 'lint',
        name: 'Lint',
        command: 'bun',
        args: ['run', 'lint'],
        cwd: '/repo',
        timeoutMs: 1000,
        status: 'failed',
        exitCode: 1,
        durationMs: 36,
        stdout: 'src/parser.ts:5:12 lint/suspicious/noExplicitAny',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        issues: [
          {
            kind: 'lint',
            filePath: 'src/parser.ts',
            line: 5,
            column: 12,
            code: 'lint/suspicious/noExplicitAny',
            message: 'Unexpected any',
          },
        ],
        keyLogs: ['src/parser.ts:5:12 lint/suspicious/noExplicitAny'],
      },
      {
        kind: 'test',
        name: 'Test',
        command: 'bun',
        args: ['test'],
        cwd: '/repo',
        timeoutMs: 1000,
        status: 'failed',
        exitCode: 1,
        durationMs: 42,
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
