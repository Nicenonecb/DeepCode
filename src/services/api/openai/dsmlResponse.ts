import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { parseDSMLToolCalls } from '../../dsml/index.js'
import type { DSMLGatewaySettings } from '../../dsml/index.js'

type TextBlock = Extract<ContentBlock, { type: 'text' }>

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

type ContentBlock = BetaMessage['content'][number]

export type DSMLResponseGatewayResult = {
  contentBlocks: BetaMessage['content']
  hasToolUse: boolean
  fellBackToText: boolean
}

export function applyDSMLResponseGateway(params: {
  contentBlocks: BetaMessage['content']
  settings: DSMLGatewaySettings | undefined
  createToolUseId: (toolName: string, index: number) => string
}): DSMLResponseGatewayResult {
  if (params.settings?.enabled !== true) {
    return {
      contentBlocks: params.contentBlocks,
      hasToolUse: false,
      fellBackToText: false,
    }
  }

  const transformedBlocks: ContentBlock[] = []
  let toolUseCount = 0
  let hasToolUse = false
  let fellBackToText = false

  for (const block of params.contentBlocks) {
    if (!isTextBlock(block)) {
      transformedBlocks.push(block)
      continue
    }

    const parsed = parseDSMLToolCalls(block.text)
    if (!parsed || parsed.toolCalls.length === 0) {
      transformedBlocks.push(block)
      continue
    }
    if (
      parsed.errors.length > 0 &&
      params.settings?.malformedResponseStrategy !== 'tool_use'
    ) {
      transformedBlocks.push(block)
      fellBackToText = true
      continue
    }

    if (parsed.prefix.trim().length > 0) {
      transformedBlocks.push({ ...block, text: parsed.prefix })
    }

    for (const toolCall of parsed.toolCalls) {
      transformedBlocks.push({
        type: 'tool_use',
        id: params.createToolUseId(toolCall.name, toolUseCount),
        name: toolCall.name,
        input: toolCall.input,
      } satisfies ToolUseBlock)
      toolUseCount++
    }

    if (parsed.suffix.trim().length > 0) {
      transformedBlocks.push({ ...block, text: parsed.suffix })
    }

    hasToolUse = true
  }

  return {
    contentBlocks: transformedBlocks,
    hasToolUse,
    fellBackToText,
  }
}

export function createDSMLToolUseId(toolName: string, index: number): string {
  const safeName = toolName.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32)
  return `toolu_dsml_${index}_${safeName || 'tool'}`
}

function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text' && typeof block.text === 'string'
}
