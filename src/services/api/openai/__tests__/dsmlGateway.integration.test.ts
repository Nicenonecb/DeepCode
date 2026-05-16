import { describe, expect, test } from 'bun:test'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { applyDSMLRequestGateway } from '../dsmlRequest.js'
import {
  buildOpenAIRequestBody,
  isOpenAIThinkingEnabled,
} from '../requestBody.js'
import {
  applyDSMLResponseGateway,
  createDSMLToolUseId,
} from '../dsmlResponse.js'
import { deepSeekV4ProDSMLFixture } from '../__fixtures__/deepseek-v4-pro-dsml.js'

describe('DSML OpenAI gateway integration', () => {
  test('switches request to DSML prompt and maps DSML response back to tool_use', () => {
    const request = applyDSMLRequestGateway({
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com/v1',
      messages: ['user asks to inspect README'],
      standardTools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
            required: ['file_path'],
          },
        },
      ],
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: { enabled: true, tagStyle: 'ascii' },
      createMetaMessage: content => content,
    })

    expect(request.enabled).toBe(true)
    expect(request.tools).toEqual([])
    expect(request.toolChoice).toBeUndefined()
    expect(request.messages[0]).toContain('<dsml_tool_protocol>')
    expect(request.messages[0]).toContain(
      '<|DSML|tool_calls>...</|DSML|tool_calls>',
    )

    const response = applyDSMLResponseGateway({
      contentBlocks: [
        {
          type: 'text',
          citations: null,
          text: `<|DSML|tool_calls>
<|DSML|invoke name="Read">
<|DSML|parameter name="file_path" string="true">README.md</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`,
        },
      ] satisfies BetaMessage['content'],
      settings: { enabled: true, tagStyle: 'ascii' },
      createToolUseId: createDSMLToolUseId,
    })

    expect(response.hasToolUse).toBe(true)
    expect(response.contentBlocks).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_dsml_0_Read',
        name: 'Read',
        input: { file_path: 'README.md' },
      },
    ])
  })

  test('keeps native function calling path when disabled', () => {
    const request = applyDSMLRequestGateway({
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com/v1',
      messages: ['user asks to inspect README'],
      standardTools: [{ name: 'Read' }],
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: { enabled: false },
      createMetaMessage: content => content,
    })

    const responseBlocks: BetaMessage['content'] = [
      {
        type: 'text',
        citations: null,
        text: '<|DSML|tool_calls></|DSML|tool_calls>',
      },
    ]
    const response = applyDSMLResponseGateway({
      contentBlocks: responseBlocks,
      settings: { enabled: false },
      createToolUseId: createDSMLToolUseId,
    })

    expect(request.enabled).toBe(false)
    expect(request.tools).toEqual([
      { type: 'function', function: { name: 'Read' } },
    ])
    expect(request.toolChoice).toEqual({ type: 'auto' })
    expect(response.hasToolUse).toBe(false)
    expect(response.contentBlocks).toBe(responseBlocks)
  })

  test('matches the DeepSeek V4 Pro provider fixture for DSML request and response', () => {
    const request = applyDSMLRequestGateway({
      model: deepSeekV4ProDSMLFixture.model,
      baseURL: deepSeekV4ProDSMLFixture.baseURL,
      messages: ['run provider fixture'],
      standardTools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { file_path: { type: 'string' } },
          },
        },
        {
          name: 'Bash',
          description: 'Run a shell command',
          input_schema: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      ],
      nativeTools: [{ type: 'function', function: { name: 'Read' } }],
      nativeToolChoice: { type: 'auto' },
      settings: { enabled: true, tagStyle: 'ascii' },
      createMetaMessage: content => content,
    })

    expect(request.decision.providerEvidence).toBe('official-deepseek')
    expect(request.decision.toolProtocol).toBe(
      deepSeekV4ProDSMLFixture.request.toolProtocol,
    )
    expect(request.tools).toEqual([
      ...deepSeekV4ProDSMLFixture.request.nativeTools,
    ])
    for (const expected of deepSeekV4ProDSMLFixture.request.promptIncludes) {
      expect(request.messages[0]).toContain(expected)
    }

    const response = applyDSMLResponseGateway({
      contentBlocks: [
        {
          type: 'text',
          citations: null,
          text: deepSeekV4ProDSMLFixture.response.text,
        },
      ] satisfies BetaMessage['content'],
      settings: { enabled: true, tagStyle: 'ascii' },
      createToolUseId: createDSMLToolUseId,
      knownToolNames: new Set(['Read', 'Bash']),
    })

    expect(response.toolUseCount).toBe(2)
    expect(
      response.contentBlocks.map(block =>
        block.type === 'tool_use'
          ? { name: block.name, input: block.input }
          : block,
      ),
    ).toEqual([...deepSeekV4ProDSMLFixture.response.expectedToolCalls])
  })

  test('matches the DeepSeek V4 Pro provider fixture for non-think requests', () => {
    const body = buildOpenAIRequestBody({
      model: deepSeekV4ProDSMLFixture.model,
      messages: [{ role: 'user', content: 'summarize this file' }],
      tools: [],
      toolChoice: undefined,
      enableThinking: isOpenAIThinkingEnabled(
        deepSeekV4ProDSMLFixture.model,
        deepSeekV4ProDSMLFixture.request.nonThink.effortValue,
      ),
      effortValue: deepSeekV4ProDSMLFixture.request.nonThink.effortValue,
      maxTokens: 384_000,
      temperatureOverride: 0.7,
    })

    expect(body.max_tokens).toBe(
      deepSeekV4ProDSMLFixture.request.nonThink.maxTokens,
    )
    expect(body.thinking).toBeUndefined()
    expect(body.reasoning_effort).toBe(
      deepSeekV4ProDSMLFixture.request.nonThink.reasoningEffort,
    )
    expect(body.enable_thinking).toBeUndefined()
    expect(body.chat_template_kwargs).toBeUndefined()
    expect(body.temperature).toBe(0.7)
  })
})
