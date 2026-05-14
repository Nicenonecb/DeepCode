import { describe, expect, test } from 'bun:test'
import { applyDSMLRequestGateway } from '../dsmlRequest.js'

describe('applyDSMLRequestGateway', () => {
  const standardTools = [
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
  ]

  test('keeps native OpenAI tools when DSML is disabled', () => {
    const result = applyDSMLRequestGateway({
      messages: ['user message'],
      standardTools,
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: { enabled: false },
      createMetaMessage: content => content,
    })

    expect(result.enabled).toBe(false)
    expect(result.messages).toEqual(['user message'])
    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'Read' } },
    ])
    expect(result.toolChoice).toEqual({ type: 'auto' })
  })

  test('injects DSML tool schema prompt and disables native tools when enabled', () => {
    const result = applyDSMLRequestGateway({
      messages: ['user message'],
      standardTools,
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: { enabled: true, tagStyle: 'ascii' },
      createMetaMessage: content => `META:${content}`,
    })

    expect(result.enabled).toBe(true)
    expect(result.tools).toEqual([])
    expect(result.toolChoice).toBeUndefined()
    expect(result.messages[0]).toContain('<dsml_tool_protocol>')
    expect(result.messages[0]).toContain(
      '<|DSML|tool_calls>...</|DSML|tool_calls>',
    )
    expect(result.messages[0]).toContain('"name": "Read"')
    expect(result.messages[0]).toContain('"file_path"')
    expect(result.messages[1]).toBe('user message')
  })
})
