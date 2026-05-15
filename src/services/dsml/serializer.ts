import type {
  DSMLOpenAIToolCall,
  DSMLSerializeOptions,
  DSMLTagStyle,
  DSMLToolCall,
  DSMLValue,
} from './types.js'

const TAGS: Record<
  DSMLTagStyle,
  {
    toolCallsOpen: string
    toolCallsClose: string
    invokeOpen: string
    invokeClose: string
    parameterOpen: string
    parameterClose: string
  }
> = {
  fullwidth: {
    toolCallsOpen: '<｜DSML｜tool_calls>',
    toolCallsClose: '</｜DSML｜tool_calls>',
    invokeOpen: '<｜DSML｜invoke',
    invokeClose: '</｜DSML｜invoke>',
    parameterOpen: '<｜DSML｜parameter',
    parameterClose: '</｜DSML｜parameter>',
  },
  ascii: {
    toolCallsOpen: '<|DSML|tool_calls>',
    toolCallsClose: '</|DSML|tool_calls>',
    invokeOpen: '<|DSML|invoke',
    invokeClose: '</|DSML|invoke>',
    parameterOpen: '<|DSML|parameter',
    parameterClose: '</|DSML|parameter>',
  },
}

export function serializeDSMLToolCalls(
  toolCalls: DSMLToolCall[],
  options: DSMLSerializeOptions = {},
): string {
  if (toolCalls.length === 0) return ''

  const tags = TAGS[options.tagStyle ?? 'fullwidth']
  const lines = [tags.toolCallsOpen]

  for (const toolCall of toolCalls) {
    lines.push(
      `${tags.invokeOpen} name="${escapeDSMLAttribute(toolCall.name)}">`,
    )
    for (const [name, value] of Object.entries(toolCall.input)) {
      const parameter = serializeParameterValue(value)
      lines.push(
        `${tags.parameterOpen} name="${escapeDSMLAttribute(
          name,
        )}" string="${parameter.isString ? 'true' : 'false'}">` +
          `${parameter.value}${tags.parameterClose}`,
      )
    }
    lines.push(tags.invokeClose)
  }

  lines.push(tags.toolCallsClose)
  return lines.join('\n')
}

export function dsmlToolCallsToOpenAI(
  toolCalls: DSMLToolCall[],
): DSMLOpenAIToolCall[] {
  return toolCalls.map((toolCall, index) => ({
    id: toolCall.id ?? createStableToolCallId(toolCall.name, index),
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.input),
    },
  }))
}

export function openAIToolCallsToDSML(
  toolCalls: DSMLOpenAIToolCall[],
): DSMLToolCall[] {
  return toolCalls.map(toolCall => ({
    id: toolCall.id,
    name: toolCall.function.name,
    input: parseOpenAIArguments(toolCall.function.arguments),
  }))
}

function serializeParameterValue(value: DSMLValue): {
  isString: boolean
  value: string
} {
  if (typeof value === 'string') {
    return { isString: true, value: escapeDSMLText(value) }
  }
  return { isString: false, value: escapeDSMLText(JSON.stringify(value)) }
}

function parseOpenAIArguments(value: string): Record<string, DSMLValue> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (isDSMLInputObject(parsed)) return parsed
  } catch {
    // Keep malformed payloads representable for diagnostics instead of
    // throwing from the pure adapter.
  }
  return { arguments: value }
}

function isDSMLInputObject(value: unknown): value is Record<string, DSMLValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createStableToolCallId(name: string, index: number): string {
  const safeName = name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32)
  return `call_dsml_${index}_${safeName || 'tool'}`
}

export function escapeDSMLText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeDSMLAttribute(value: string): string {
  return escapeDSMLText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
