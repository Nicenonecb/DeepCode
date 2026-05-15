import type { DSMLGatewaySettings, DSMLTagStyle } from './types.js'

type DSMLToolSchema = {
  name?: unknown
  description?: unknown
  input_schema?: unknown
  type?: unknown
}

const DEFAULT_MAX_PROMPT_CHARS = 24_000

export function shouldUseDSMLGateway(
  settings: DSMLGatewaySettings | undefined,
): boolean {
  return settings?.enabled === true
}

export function buildDSMLToolSchemaPrompt(
  tools: DSMLToolSchema[],
  settings: DSMLGatewaySettings | undefined,
): string | undefined {
  if (!shouldUseDSMLGateway(settings) || tools.length === 0) return undefined

  const tagStyle = normalizeTagStyle(settings?.tagStyle)
  const maxPromptChars = normalizeMaxPromptChars(settings?.maxPromptChars)
  const prompt = [
    '<dsml_tool_protocol>',
    'Use DSML tool calls instead of native OpenAI function calling for this request.',
    `Wrap tool calls in ${formatToolCallsExample(tagStyle)}.`,
    'Use one invoke block per tool call. Put each argument in a parameter block.',
    'Set string="true" for string arguments and string="false" for JSON values.',
    'Available tools:',
    serializeToolSchemas(tools),
    '</dsml_tool_protocol>',
  ].join('\n')

  return prompt.length <= maxPromptChars
    ? prompt
    : `${prompt.slice(0, maxPromptChars)}\n</dsml_tool_protocol>`
}

function serializeToolSchemas(tools: DSMLToolSchema[]): string {
  return JSON.stringify(
    tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
    null,
    2,
  )
}

function formatToolCallsExample(tagStyle: DSMLTagStyle): string {
  if (tagStyle === 'ascii') {
    return '<|DSML|tool_calls>...</|DSML|tool_calls>'
  }
  return '<｜DSML｜tool_calls>...</｜DSML｜tool_calls>'
}

function normalizeTagStyle(value: unknown): DSMLTagStyle {
  return value === 'ascii' ? 'ascii' : 'fullwidth'
}

function normalizeMaxPromptChars(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_MAX_PROMPT_CHARS
}
