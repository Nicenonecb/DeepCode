import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  VerificationRunner,
  detectVerificationCommands,
  executeVerificationCommand,
  formatVerificationStatusMessage,
  formatVerificationSummary,
  parseVerificationOutput,
  shouldRunVerificationOnCompletion,
  summarizeVerificationResults,
  type VerificationCommand,
  type VerificationCommandExecutionResult,
  type VerificationCommandExecutor,
  type VerificationResult,
} from '../VerificationRunner.js'

describe('detectVerificationCommands', () => {
  test('detects typecheck, lint, and bun test commands from package scripts', () => {
    expect(
      detectVerificationCommands({
        cwd: '/repo',
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'biome lint .',
          test: 'bun test',
        },
        timeoutMs: 123,
      }),
    ).toEqual([
      {
        kind: 'typecheck',
        name: 'Typecheck',
        command: 'bun',
        args: ['run', 'typecheck'],
        cwd: '/repo',
        timeoutMs: 123,
      },
      {
        kind: 'lint',
        name: 'Lint',
        command: 'bun',
        args: ['run', 'lint'],
        cwd: '/repo',
        timeoutMs: 123,
      },
      {
        kind: 'test',
        name: 'Test',
        command: 'bun',
        args: ['test'],
        cwd: '/repo',
        timeoutMs: 123,
      },
    ])
  })

  test('prefers test:all over plain test when both scripts exist', () => {
    expect(
      detectVerificationCommands({
        cwd: '/repo',
        scripts: {
          test: 'bun test',
          'test:all': 'bun run typecheck && bun test',
        },
      }).find(command => command.kind === 'test')?.args,
    ).toEqual(['run', 'test:all'])
  })

  test('returns no commands when package scripts do not include verifiers', () => {
    expect(
      detectVerificationCommands({
        cwd: '/repo',
        scripts: {
          dev: 'bun run src/main.tsx',
        },
      }),
    ).toEqual([])
  })

  test('uses configured commands instead of package script detection', () => {
    expect(
      detectVerificationCommands({
        cwd: '/repo',
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'biome lint .',
          test: 'bun test',
        },
        timeoutMs: 100,
        configuredCommands: [
          'bun run typecheck',
          {
            kind: 'test',
            name: 'Focused test',
            command: 'bun',
            args: ['test', 'src/foo.test.ts'],
            timeoutMs: 50,
          },
        ],
      }),
    ).toEqual([
      {
        kind: 'typecheck',
        name: 'Typecheck',
        command: 'bun',
        args: ['run', 'typecheck'],
        cwd: '/repo',
        timeoutMs: 100,
      },
      {
        kind: 'test',
        name: 'Focused test',
        command: 'bun',
        args: ['test', 'src/foo.test.ts'],
        cwd: '/repo',
        timeoutMs: 50,
      },
    ])
  })
})

describe('VerificationRunner', () => {
  test('reads package.json and runs detected commands through the executor', async () => {
    const cwd = await makeTempPackage({
      typecheck: 'tsc --noEmit',
      lint: 'biome lint .',
      test: 'bun test',
    })
    const seen: VerificationCommand[] = []
    const executor: VerificationCommandExecutor = async command => {
      seen.push(command)
      return successfulExecution(`${command.kind} ok`)
    }

    try {
      const summary = await new VerificationRunner({
        cwd,
        timeoutMs: 50,
        executor,
      }).run()

      expect(seen.map(command => command.kind)).toEqual([
        'typecheck',
        'lint',
        'test',
      ])
      expect(summary).toMatchObject({
        status: 'passed',
        total: 3,
        passed: 3,
        failed: 0,
        timedOut: 0,
      })
      expect(summary.results.map(result => result.stdout)).toEqual([
        'typecheck ok',
        'lint ok',
        'test ok',
      ])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('marks non-zero command executions as failed', async () => {
    const cwd = await makeTempPackage({ typecheck: 'tsc --noEmit' })
    const executor = makeExecutor(() => ({
      exitCode: 2,
      stdout: '',
      stderr: 'src/index.ts(1,1): error TS2304',
    }))

    try {
      const summary = await new VerificationRunner({ cwd, executor }).run()

      expect(summary.status).toBe('failed')
      expect(summary.failed).toBe(1)
      expect(summary.results[0]).toMatchObject({
        kind: 'typecheck',
        status: 'failed',
        exitCode: 2,
        stderr: 'src/index.ts(1,1): error TS2304',
        issues: [
          {
            kind: 'typescript',
            filePath: 'src/index.ts',
            line: 1,
            column: 1,
            code: 'TS2304',
          },
        ],
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('marks timed-out command executions separately from failures', async () => {
    const cwd = await makeTempPackage({ test: 'bun test' })
    const executor = makeExecutor(() => ({
      exitCode: null,
      stdout: 'still running',
      stderr: '',
      timedOut: true,
    }))

    try {
      const summary = await new VerificationRunner({ cwd, executor }).run()

      expect(summary.status).toBe('timed_out')
      expect(summary.timedOut).toBe(1)
      expect(summary.results[0]).toMatchObject({
        kind: 'test',
        status: 'timed_out',
        exitCode: null,
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('does not run commands when disabled in settings', async () => {
    const cwd = await makeTempPackage({ test: 'bun test' })
    const seen: VerificationCommand[] = []
    const executor: VerificationCommandExecutor = async command => {
      seen.push(command)
      return successfulExecution('should not run')
    }

    try {
      const summary = await new VerificationRunner({
        cwd,
        settings: { enabled: false },
        executor,
      }).run()

      expect(seen).toEqual([])
      expect(summary).toMatchObject({
        status: 'passed',
        total: 0,
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('applies settings timeout and truncates long command logs', async () => {
    const cwd = await makeTempPackage({ test: 'bun test' })
    const seen: VerificationCommand[] = []
    const executor: VerificationCommandExecutor = async command => {
      seen.push(command)
      return {
        exitCode: 1,
        stdout: `before ${'x'.repeat(120)} after`,
        stderr: `error ${'y'.repeat(120)} failed`,
      }
    }

    try {
      const summary = await new VerificationRunner({
        cwd,
        maxOutputChars: 80,
        settings: { timeoutMs: 321 },
        executor,
      }).run()

      expect(seen[0]?.timeoutMs).toBe(321)
      expect(summary.results[0]?.stdoutTruncated).toBe(true)
      expect(summary.results[0]?.stderrTruncated).toBe(true)
      expect(summary.results[0]?.stdout).toContain('verification log truncated')
      expect(summary.results[0]?.stdout.length).toBeLessThanOrEqual(80)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('parseVerificationOutput', () => {
  test('extracts TypeScript file, line, column, and code', () => {
    expect(
      parseVerificationOutput(
        { kind: 'typecheck', name: 'Typecheck' },
        failedExecution(
          '',
          'src/foo.ts(12,8): error TS2322: Type string is not assignable to type number.',
        ),
      ).issues,
    ).toEqual([
      {
        kind: 'typescript',
        filePath: 'src/foo.ts',
        line: 12,
        column: 8,
        code: 'TS2322',
        message: 'Type string is not assignable to type number.',
      },
    ])
  })

  test('extracts lint locations and failing test names', () => {
    expect(
      parseVerificationOutput(
        { kind: 'lint', name: 'Lint' },
        failedExecution(
          'src/foo.ts:3:7 lint/suspicious/noExplicitAny Use unknown instead.',
          '',
        ),
      ).issues[0],
    ).toMatchObject({
      kind: 'lint',
      filePath: 'src/foo.ts',
      line: 3,
      column: 7,
      code: 'lint/suspicious/noExplicitAny',
    })

    expect(
      parseVerificationOutput(
        { kind: 'test', name: 'Test' },
        failedExecution('(fail) parser > rejects invalid input [1.00ms]', ''),
      ).issues[0],
    ).toMatchObject({
      kind: 'test',
      testName: 'parser > rejects invalid input',
    })
  })

  test('extracts JUnit failure names, messages, and locations', () => {
    const parsed = parseVerificationOutput(
      { kind: 'test', name: 'JUnit' },
      failedExecution(
        `<?xml version="1.0"?>
<testsuite failures="1">
  <testcase classname="parser suite" name="rejects invalid input">
    <failure message="Expected parse error">AssertionError at src/parser.test.ts:42:9</failure>
  </testcase>
</testsuite>`,
        '',
      ),
    )

    expect(parsed.issues[0]).toMatchObject({
      kind: 'test',
      testName: 'parser suite > rejects invalid input',
      message: 'Expected parse error',
      filePath: 'src/parser.test.ts',
      line: 42,
      column: 9,
    })
  })

  test('extracts reporter file locations near failed test lines', () => {
    const parsed = parseVerificationOutput(
      { kind: 'test', name: 'Reporter' },
      failedExecution(
        `(fail) parser > rejects invalid input [1.00ms]
  at src/parser.test.ts:12:5`,
        '',
      ),
    )

    expect(parsed.issues[0]).toMatchObject({
      kind: 'test',
      testName: 'parser > rejects invalid input',
      filePath: 'src/parser.test.ts',
      line: 12,
      column: 5,
    })
  })

  test('extracts suite file reporter failures', () => {
    const parsed = parseVerificationOutput(
      { kind: 'test', name: 'Vitest' },
      failedExecution(
        `FAIL src/math.spec.ts > calculator > adds numbers
AssertionError: expected 1 to be 2`,
        '',
      ),
    )

    expect(parsed.issues[0]).toMatchObject({
      kind: 'test',
      filePath: 'src/math.spec.ts',
      testName: 'calculator > adds numbers',
      message: 'calculator > adds numbers',
    })
  })

  test('extracts JUnit CDATA failure locations', () => {
    const parsed = parseVerificationOutput(
      { kind: 'test', name: 'JUnit' },
      failedExecution(
        `<testsuite failures="1">
  <testcase classname="api suite" name="returns 200">
    <failure><![CDATA[Expected status 200
    at src/api.spec.ts:88:11]]></failure>
  </testcase>
</testsuite>`,
        '',
      ),
    )

    expect(parsed.issues[0]).toMatchObject({
      kind: 'test',
      testName: 'api suite > returns 200',
      message: 'Expected status 200',
      filePath: 'src/api.spec.ts',
      line: 88,
      column: 11,
    })
  })

  test('falls back to key logs when a failing command has no structured issue', () => {
    const parsed = parseVerificationOutput(
      { kind: 'test', name: 'Test' },
      failedExecution('setup complete\nUnexpected runtime failure', ''),
    )

    expect(parsed.issues).toEqual([
      {
        kind: 'command',
        message: 'Unexpected runtime failure',
      },
    ])
    expect(parsed.keyLogs).toEqual(['Unexpected runtime failure'])
  })
})

describe('formatVerificationSummary', () => {
  test('produces model-readable failure guidance', () => {
    const summary = summarizeVerificationResults([
      {
        ...makeResult('typecheck', 'failed'),
        issues: [
          {
            kind: 'typescript',
            filePath: 'src/foo.ts',
            line: 1,
            column: 2,
            code: 'TS2304',
            message: 'Cannot find name x.',
          },
        ],
        keyLogs: ['src/foo.ts(1,2): error TS2304: Cannot find name x.'],
      },
    ])

    expect(formatVerificationSummary(summary)).toContain(
      'completion_assessment: verification failed; do not final-reply yet.',
    )
    expect(formatVerificationSummary(summary)).toContain(
      '[typescript] src/foo.ts:1:2 TS2304',
    )
  })
})

describe('formatVerificationStatusMessage', () => {
  test('produces compact visible UI status', () => {
    const summary = summarizeVerificationResults([
      {
        ...makeResult('test', 'failed'),
        issues: [
          {
            kind: 'test',
            testName: 'parser > rejects invalid input',
            message: 'parser > rejects invalid input',
          },
        ],
      },
    ])

    expect(formatVerificationStatusMessage(summary)).toContain(
      'Verification failed: 0/1 commands passed.',
    )
    expect(formatVerificationStatusMessage(summary)).toContain(
      'parser > rejects invalid input',
    )
  })
})

describe('shouldRunVerificationOnCompletion', () => {
  test('defaults to enabled and respects config disable switches', () => {
    expect(shouldRunVerificationOnCompletion()).toBe(true)
    expect(shouldRunVerificationOnCompletion({ enabled: false })).toBe(false)
    expect(shouldRunVerificationOnCompletion({ runOnCompletion: false })).toBe(
      false,
    )
  })
})

describe('executeVerificationCommand', () => {
  test('runs a real command and captures output', async () => {
    const result = await executeVerificationCommand({
      kind: 'test',
      name: 'Bun version',
      command: 'bun',
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(result.timedOut).toBeUndefined()
  })
})

describe('summarizeVerificationResults', () => {
  test('uses the strongest status from result outcomes', () => {
    const results = [
      makeResult('typecheck', 'passed'),
      makeResult('lint', 'failed'),
      makeResult('test', 'timed_out'),
    ]

    expect(summarizeVerificationResults(results)).toMatchObject({
      status: 'timed_out',
      total: 3,
      passed: 1,
      failed: 1,
      timedOut: 1,
    })
  })
})

async function makeTempPackage(
  scripts: Record<string, string>,
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-verification-'))
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({ type: 'module', scripts }),
  )
  return cwd
}

function makeExecutor(
  run: (command: VerificationCommand) => VerificationCommandExecutionResult,
): VerificationCommandExecutor {
  return async command => run(command)
}

function successfulExecution(
  stdout: string,
): VerificationCommandExecutionResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
  }
}

function failedExecution(
  stdout: string,
  stderr: string,
): VerificationCommandExecutionResult {
  return {
    exitCode: 1,
    stdout,
    stderr,
  }
}

function makeResult(
  kind: VerificationCommand['kind'],
  status: VerificationResult['status'],
): VerificationResult {
  return {
    kind,
    status,
    name: kind,
    command: 'bun',
    args: ['test'],
    cwd: '/repo',
    timeoutMs: 1000,
    exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
    durationMs: 10,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    issues: [],
    keyLogs: [],
  }
}
