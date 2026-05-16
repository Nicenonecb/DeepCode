import { describe, expect, test } from 'bun:test'
import { DEEPSEEK_DEFAULT_BASE_URL } from '../../../deepseek/config.js'
import {
  applyDSMLRequestGateway,
  resolveDSMLGatewayDecision,
} from '../dsmlRequest.js'

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
      model: 'deepseek-v4-pro',
      baseURL: DEEPSEEK_DEFAULT_BASE_URL,
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
      model: 'deepseek-v4-pro',
      baseURL: DEEPSEEK_DEFAULT_BASE_URL,
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

  test('defaults DeepSeek V4 Pro to native OpenAI tools unless DSML is explicitly enabled', () => {
    const result = applyDSMLRequestGateway({
      model: 'deepseek-v4-pro',
      baseURL: DEEPSEEK_DEFAULT_BASE_URL,
      messages: ['user message'],
      standardTools,
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: undefined,
      createMetaMessage: content => content,
    })

    expect(result.enabled).toBe(false)
    expect(result.decision).toMatchObject({
      toolProtocol: 'openai-tools',
      source: 'fallback',
      fallbackReason: 'explicit-opt-in-required',
      providerEvidence: 'official-deepseek',
      modelProfileId: 'deepseek-v4-pro',
    })
    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'Read' } },
    ])
  })

  test('falls back to native OpenAI tools for unverified compatible endpoints', () => {
    const result = applyDSMLRequestGateway({
      model: 'deepseek-v4-pro',
      baseURL: 'http://localhost:11434/v1',
      messages: ['user message'],
      standardTools,
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: undefined,
      createMetaMessage: content => content,
    })

    expect(result.enabled).toBe(false)
    expect(result.decision.fallbackReason).toBe('provider-not-verified')
    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'Read' } },
    ])
  })

  test('lets env explicitly disable the DSML default', () => {
    const original = process.env.DEEPSEEK_DSML_GATEWAY
    process.env.DEEPSEEK_DSML_GATEWAY = '0'
    try {
      expect(
        resolveDSMLGatewayDecision({
          model: 'deepseek-v4-pro',
          baseURL: DEEPSEEK_DEFAULT_BASE_URL,
        }),
      ).toMatchObject({
        toolProtocol: 'openai-tools',
        enabled: false,
        source: 'env',
        fallbackReason: 'env-disabled',
      })
    } finally {
      if (original === undefined) delete process.env.DEEPSEEK_DSML_GATEWAY
      else process.env.DEEPSEEK_DSML_GATEWAY = original
    }
  })
})
