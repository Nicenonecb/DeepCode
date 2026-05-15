import type {
  DSMLParseError,
  DSMLParseResult,
  DSMLToolCall,
  DSMLToolInput,
  DSMLValue,
} from './types.js'

const DSML_TAG = '[|｜]DSML[|｜]'
const TOOL_CALLS_BLOCK_RE = new RegExp(
  `<${DSML_TAG}tool_calls>([\\s\\S]*?)<\\/${DSML_TAG}tool_calls>`,
  'i',
)
const INVOKE_RE = new RegExp(
  `<${DSML_TAG}invoke\\s+([^>]*)>([\\s\\S]*?)<\\/${DSML_TAG}invoke>`,
  'gi',
)
const PARAMETER_RE = new RegExp(
  `<${DSML_TAG}parameter\\s+([^>]*)>([\\s\\S]*?)<\\/${DSML_TAG}parameter>`,
  'gi',
)
const ATTRIBUTE_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function parseDSMLToolCalls(text: string): DSMLParseResult | undefined {
  const blockMatch = TOOL_CALLS_BLOCK_RE.exec(text)
  if (!blockMatch || blockMatch.index === undefined) return undefined

  const raw = blockMatch[0]
  const body = blockMatch[1] ?? ''
  const errors: DSMLParseError[] = []
  const toolCalls: DSMLToolCall[] = []

  for (const invokeMatch of body.matchAll(INVOKE_RE)) {
    const rawInvoke = invokeMatch[0]
    const invokeOffset = blockMatch.index + raw.indexOf(rawInvoke)
    const attrs = parseAttributes(invokeMatch[1] ?? '')
    const name = attrs.name?.trim()
    if (!name) {
      errors.push({
        message: 'DSML invoke is missing a tool name',
        offset: invokeOffset,
        raw: rawInvoke,
      })
      continue
    }

    const input = parseParameters(
      invokeMatch[2] ?? '',
      blockMatch.index,
      errors,
    )
    toolCalls.push({ name: unescapeDSMLText(name), input, raw: rawInvoke })
  }

  return {
    raw,
    prefix: text.slice(0, blockMatch.index),
    suffix: text.slice(blockMatch.index + raw.length),
    toolCalls,
    errors,
  }
}

function parseParameters(
  body: string,
  blockOffset: number,
  errors: DSMLParseError[],
): DSMLToolInput {
  const input: DSMLToolInput = {}

  for (const parameterMatch of body.matchAll(PARAMETER_RE)) {
    const rawParameter = parameterMatch[0]
    const attrs = parseAttributes(parameterMatch[1] ?? '')
    const name = attrs.name?.trim()
    if (!name) {
      errors.push({
        message: 'DSML parameter is missing a name',
        offset: blockOffset + body.indexOf(rawParameter),
        raw: rawParameter,
      })
      continue
    }

    const isString = attrs.string !== 'false'
    input[unescapeDSMLText(name)] = parseParameterValue(
      parameterMatch[2] ?? '',
      isString,
      blockOffset + body.indexOf(rawParameter),
      rawParameter,
      errors,
    )
  }

  return input
}

function parseParameterValue(
  rawValue: string,
  isString: boolean,
  offset: number,
  rawParameter: string,
  errors: DSMLParseError[],
): DSMLValue {
  const value = unescapeDSMLText(rawValue.trim())
  if (isString) return value

  try {
    return JSON.parse(value) as DSMLValue
  } catch {
    errors.push({
      message: 'DSML non-string parameter is not valid JSON',
      offset,
      raw: rawParameter,
    })
    return value
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(ATTRIBUTE_RE)) {
    attrs[match[1]] = match[2] ?? match[3] ?? ''
  }
  return attrs
}

export function unescapeDSMLText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}
