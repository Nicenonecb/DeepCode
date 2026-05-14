import { describe, expect, test } from 'bun:test'
import {
  buildDSMLToolSchemaPrompt,
  dsmlToolCallsToOpenAI,
  openAIToolCallsToDSML,
  parseDSMLToolCalls,
  serializeDSMLToolCalls,
  type DSMLToolCall,
} from '../index.js'

describe('DSML parser and serializer', () => {
  test('parses fullwidth DSML tool calls with string and JSON parameters', () => {
    const parsed = parseDSMLToolCalls(`
before
<｜DSML｜tool_calls>
<｜DSML｜invoke name="Edit">
<｜DSML｜parameter name="file_path" string="true">src/index.ts</｜DSML｜parameter>
<｜DSML｜parameter name="replace_all" string="false">true</｜DSML｜parameter>
<｜DSML｜parameter name="patch" string="false">{"old":"a","new":"b"}</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>
after`)

    expect(parsed?.prefix.trim()).toBe('before')
    expect(parsed?.suffix.trim()).toBe('after')
    expect(parsed?.errors).toEqual([])
    expect(parsed?.toolCalls).toEqual([
      {
        name: 'Edit',
        input: {
          file_path: 'src/index.ts',
          replace_all: true,
          patch: { old: 'a', new: 'b' },
        },
      },
    ])
  })

  test('parses ASCII DSML tags and multiple invokes', () => {
    const parsed = parseDSMLToolCalls(`<|DSML|tool_calls>
<|DSML|invoke name="Read">
<|DSML|parameter name="file_path" string="true">README.md</|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="Bash">
<|DSML|parameter name="command" string="true">bun test</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`)

    expect(parsed?.toolCalls.map(call => call.name)).toEqual(['Read', 'Bash'])
    expect(parsed?.toolCalls[1]?.input.command).toBe('bun test')
  })

  test('preserves a real arguments parameter instead of unwrapping it', () => {
    const parsed = parseDSMLToolCalls(`<｜DSML｜tool_calls>
<｜DSML｜invoke name="Tool">
<｜DSML｜parameter name="arguments" string="false">{"literal":true}</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`)

    expect(parsed?.toolCalls[0]?.input).toEqual({
      arguments: { literal: true },
    })
  })

  test('serializes and roundtrips DSML tool calls', () => {
    const calls: DSMLToolCall[] = [
      {
        name: 'Write',
        input: {
          file_path: 'src/a.ts',
          content: 'const x = 1 < 2 && "ok"',
          metadata: { retries: 2, ok: true },
        },
      },
    ]

    const serialized = serializeDSMLToolCalls(calls)
    const parsed = parseDSMLToolCalls(serialized)

    expect(serialized).toContain('<｜DSML｜tool_calls>')
    expect(serialized).toContain('string="true"')
    expect(serialized).toContain('string="false"')
    expect(parsed?.toolCalls).toEqual(calls)
  })

  test('converts DSML tool calls to and from OpenAI tool_calls shape', () => {
    const dsmlCalls: DSMLToolCall[] = [
      {
        id: 'call_1',
        name: 'Read',
        input: { file_path: 'README.md' },
      },
    ]

    const openaiCalls = dsmlToolCallsToOpenAI(dsmlCalls)
    expect(openaiCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'Read',
          arguments: '{"file_path":"README.md"}',
        },
      },
    ])
    expect(openAIToolCallsToDSML(openaiCalls)).toEqual(dsmlCalls)
  })
})

describe('DSML gateway prompt', () => {
  test('serializes tool schemas into a bounded DSML instruction prompt', () => {
    const prompt = buildDSMLToolSchemaPrompt(
      [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
          },
        },
      ],
      {
        enabled: true,
        tagStyle: 'ascii',
      },
    )

    expect(prompt).toContain('<dsml_tool_protocol>')
    expect(prompt).toContain('<|DSML|tool_calls>...</|DSML|tool_calls>')
    expect(prompt).toContain('"name": "Read"')
    expect(prompt).toContain('"file_path"')
  })

  test('does not build a prompt unless the gateway is enabled', () => {
    expect(
      buildDSMLToolSchemaPrompt([{ name: 'Read' }], { enabled: false }),
    ).toBeUndefined()
  })
})
