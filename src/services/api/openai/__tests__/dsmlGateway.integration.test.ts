import { describe, expect, test } from 'bun:test'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { applyDSMLRequestGateway } from '../dsmlRequest.js'
import {
  applyDSMLResponseGateway,
  createDSMLToolUseId,
} from '../dsmlResponse.js'

describe('DSML OpenAI gateway integration', () => {
  test('switches request to DSML prompt and maps DSML response back to tool_use', () => {
    const request = applyDSMLRequestGateway({
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
})
