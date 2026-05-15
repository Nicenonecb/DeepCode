import { describe, expect, test } from 'bun:test'
import { classifyToolCallError } from '../ToolCallErrorClassifier.js'

describe('classifyToolCallError', () => {
  test('classifies JSON parse failures as retryable parse errors', () => {
    let error: unknown
    try {
      JSON.parse('{bad json')
    } catch (caught) {
      error = caught
    }

    const summary = classifyToolCallError({
      toolUseId: 'toolu_parse',
      toolName: 'Bash',
      input: '{bad json',
      error,
    })

    expect(summary.kind).toBe('parse_error')
    expect(summary.retryable).toBe(true)
    expect(summary.repairHint).toContain('valid JSON object')
    expect(summary.message).toContain('JSON')
  })

  test('classifies InputValidationError messages as schema errors', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_schema',
      toolName: 'FileRead',
      input: { path: 123 },
      message:
        'InputValidationError: FileRead failed due to the following issue:\nThe parameter `path` type is expected as `string` but provided as `number`',
    })

    expect(summary.kind).toBe('schema_error')
    expect(summary.retryable).toBe(true)
    expect(summary.repairHint).toContain('tool schema')
    expect(summary.toolUseId).toBe('toolu_schema')
    expect(summary.toolName).toBe('FileRead')
  })

  test('classifies zod-shaped validation errors as schema errors', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_zod',
      toolName: 'Edit',
      input: { file_path: '/tmp/a', old_string: undefined },
      error: {
        name: 'ZodError',
        message: 'Invalid input',
        issues: [{ path: ['old_string'], code: 'invalid_type' }],
      },
    })

    expect(summary.kind).toBe('schema_error')
    expect(summary.input).toEqual({ file_path: '/tmp/a' })
  })

  test('classifies unknown tools as missing_tool', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_missing',
      toolName: 'DefinitelyNotATool',
      input: {},
      message: 'Error: No such tool available: DefinitelyNotATool',
    })

    expect(summary.kind).toBe('missing_tool')
    expect(summary.retryable).toBe(true)
    expect(summary.repairHint).toContain('available tool name')
  })

  test('classifies permission denials as non-retryable permission errors', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_permission',
      toolName: 'Bash',
      input: { command: 'rm -rf dist' },
      message: 'Permission denied',
    })

    expect(summary.kind).toBe('permission_error')
    expect(summary.retryable).toBe(false)
    expect(summary.repairHint).toContain('Ask for permission')
  })

  test('classifies abort-shaped errors as cancelled', () => {
    const abort = new Error('The user interrupted this tool call')
    abort.name = 'AbortError'

    const summary = classifyToolCallError({
      toolUseId: 'toolu_cancelled',
      toolName: 'Bash',
      input: { command: 'sleep 10' },
      error: abort,
    })

    expect(summary.kind).toBe('cancelled')
    expect(summary.retryable).toBe(false)
  })

  test('classifies unrecognized exceptions as runtime errors', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_runtime',
      toolName: 'WebFetch',
      input: { url: 'https://example.test' },
      error: new Error('socket hang up'),
    })

    expect(summary.kind).toBe('runtime_error')
    expect(summary.retryable).toBe(false)
    expect(summary.message).toBe('socket hang up')
  })

  test('does not treat generic SyntaxError as JSON parse repair', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_runtime_syntax',
      toolName: 'RuntimeTool',
      input: {},
      error: new SyntaxError('Unexpected identifier in evaluated script'),
    })

    expect(summary.kind).toBe('runtime_error')
  })

  test('honors explicit sources and retry overrides', () => {
    const summary = classifyToolCallError({
      toolUseId: 'toolu_source',
      toolName: 'Tool',
      input: {},
      source: 'json_parse_error',
      message: 'custom parser said nope',
      retryable: false,
      repairHint: 'Use the custom grammar.',
    })

    expect(summary.kind).toBe('parse_error')
    expect(summary.retryable).toBe(false)
    expect(summary.repairHint).toBe('Use the custom grammar.')
  })

  test('normalizes input into stable serializable JSON', () => {
    const circular: Record<string, unknown> = { b: 2, a: 1 }
    circular.self = circular

    const summary = classifyToolCallError({
      toolUseId: 'toolu_stable',
      toolName: 'Tool',
      input: {
        z: undefined,
        nested: { b: 2, a: 1 },
        list: [1, undefined, BigInt(3)],
        circular,
      },
      message: 'boom',
    })

    expect(JSON.stringify(summary)).toBe(
      '{"kind":"runtime_error","toolUseId":"toolu_stable","toolName":"Tool","input":{"circular":{"a":1,"b":2,"self":"[Circular]"},"list":[1,null,"3"],"nested":{"a":1,"b":2}},"message":"boom","retryable":false,"repairHint":"Inspect the runtime error and retry only if changing the tool input can address it."}',
    )
  })
})
