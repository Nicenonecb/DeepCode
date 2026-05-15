import { describe, expect, test } from 'bun:test'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  applyDSMLResponseGateway,
  createDSMLToolUseId,
} from '../dsmlResponse.js'

describe('applyDSMLResponseGateway', () => {
  test('leaves text untouched when DSML gateway is disabled', () => {
    const contentBlocks: BetaMessage['content'] = [
      {
        type: 'text',
        citations: null,
        text: '<｜DSML｜tool_calls></｜DSML｜tool_calls>',
      },
    ]

    const result = applyDSMLResponseGateway({
      contentBlocks,
      settings: { enabled: false },
      createToolUseId: createDSMLToolUseId,
    })

    expect(result.hasToolUse).toBe(false)
    expect(result.contentBlocks).toBe(contentBlocks)
    expect(result.toolUseCount).toBe(0)
  })

  test('maps DSML tool calls in text into Anthropic tool_use blocks', () => {
    const result = applyDSMLResponseGateway({
      contentBlocks: [
        {
          type: 'text',
          citations: null,
          text: `I will inspect the file.
<｜DSML｜tool_calls>
<｜DSML｜invoke name="Read">
<｜DSML｜parameter name="file_path" string="true">README.md</｜DSML｜parameter>
<｜DSML｜parameter name="limit" string="false">100</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`,
        },
      ],
      settings: { enabled: true },
      createToolUseId: createDSMLToolUseId,
    })

    expect(result.hasToolUse).toBe(true)
    expect(result.toolUseCount).toBe(1)
    expect(result.parseErrorCount).toBe(0)
    expect(result.contentBlocks).toEqual([
      {
        type: 'text',
        citations: null,
        text: 'I will inspect the file.\n',
      },
      {
        type: 'tool_use',
        id: 'toolu_dsml_0_Read',
        name: 'Read',
        input: {
          file_path: 'README.md',
          limit: 100,
        },
      },
    ])
  })

  test('maps multiple DSML invokes and preserves suffix text', () => {
    const result = applyDSMLResponseGateway({
      contentBlocks: [
        {
          type: 'text',
          citations: null,
          text: `<|DSML|tool_calls>
<|DSML|invoke name="Read">
<|DSML|parameter name="file_path" string="true">a.ts</|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="Bash">
<|DSML|parameter name="command" string="true">bun test</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>
Then I will continue.`,
        },
      ],
      settings: { enabled: true },
      createToolUseId: createDSMLToolUseId,
    })

    expect(result.contentBlocks).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_dsml_0_Read',
        name: 'Read',
        input: { file_path: 'a.ts' },
      },
      {
        type: 'tool_use',
        id: 'toolu_dsml_1_Bash',
        name: 'Bash',
        input: { command: 'bun test' },
      },
      {
        type: 'text',
        citations: null,
        text: '\nThen I will continue.',
      },
    ])
    expect(result.toolUseCount).toBe(2)
  })

  test('falls back to original text for malformed DSML by default', () => {
    const contentBlocks: BetaMessage['content'] = [
      {
        type: 'text',
        citations: null,
        text: `<｜DSML｜tool_calls>
<｜DSML｜invoke name="Read">
<｜DSML｜parameter name="limit" string="false">not-json</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`,
      },
    ]

    const result = applyDSMLResponseGateway({
      contentBlocks,
      settings: { enabled: true },
      createToolUseId: createDSMLToolUseId,
    })

    expect(result.hasToolUse).toBe(false)
    expect(result.fellBackToText).toBe(true)
    expect(result.parseErrorCount).toBe(1)
    expect(result.contentBlocks).toEqual(contentBlocks)
  })

  test('can emit parseable tool calls from malformed DSML when configured', () => {
    const result = applyDSMLResponseGateway({
      contentBlocks: [
        {
          type: 'text',
          citations: null,
          text: `<｜DSML｜tool_calls>
<｜DSML｜invoke name="Read">
<｜DSML｜parameter name="limit" string="false">not-json</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`,
        },
      ],
      settings: { enabled: true, malformedResponseStrategy: 'tool_use' },
      createToolUseId: createDSMLToolUseId,
    })

    expect(result.hasToolUse).toBe(true)
    expect(result.fellBackToText).toBe(false)
    expect(result.parseErrorCount).toBe(1)
    expect(result.contentBlocks).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_dsml_0_Read',
        name: 'Read',
        input: { limit: 'not-json' },
      },
    ])
  })

  test('emits known tool calls while preserving unknown DSML invokes as text', () => {
    const result = applyDSMLResponseGateway({
      contentBlocks: [
        {
          type: 'text',
          citations: null,
          text: `<|DSML|tool_calls>
<|DSML|invoke name="Read">
<|DSML|parameter name="file_path" string="true">a.ts</|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="NotATool">
<|DSML|parameter name="x" string="true">1</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`,
        },
      ],
      settings: { enabled: true },
      createToolUseId: createDSMLToolUseId,
      knownToolNames: new Set(['Read']),
    })

    expect(result.hasToolUse).toBe(true)
    expect(result.fellBackToText).toBe(true)
    expect(result.toolUseCount).toBe(1)
    expect(result.unknownToolCount).toBe(1)
    expect(result.contentBlocks).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_dsml_0_Read',
        name: 'Read',
        input: { file_path: 'a.ts' },
      },
      {
        type: 'text',
        citations: null,
        text: `<|DSML|invoke name="NotATool">
<|DSML|parameter name="x" string="true">1</|DSML|parameter>
</|DSML|invoke>`,
      },
    ])
  })
})
