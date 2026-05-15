import type {
  JsonValue,
  ToolCallErrorClassifierInput,
  ToolCallErrorKind,
  ToolCallErrorSource,
  ToolCallRepairSummary,
} from './types.js'

const DEFAULT_REPAIR_HINTS: Record<ToolCallErrorKind, string> = {
  parse_error:
    'Return a valid JSON object for the tool input, preserving the intended arguments.',
  schema_error:
    'Rewrite the tool input so every argument matches the tool schema.',
  permission_error:
    'Do not retry automatically. Ask for permission or choose a permitted alternative.',
  runtime_error:
    'Inspect the runtime error and retry only if changing the tool input can address it.',
  missing_tool:
    'Use an available tool name or discover the tool before retrying.',
  cancelled:
    'Do not retry automatically. The tool call was cancelled before completion.',
}

const DEFAULT_RETRYABLE: Record<ToolCallErrorKind, boolean> = {
  parse_error: true,
  schema_error: true,
  permission_error: false,
  runtime_error: false,
  missing_tool: true,
  cancelled: false,
}

export function classifyToolCallError(
  params: ToolCallErrorClassifierInput,
): ToolCallRepairSummary {
  const message = normalizeMessage(params)
  const kind = params.source
    ? kindFromSource(params.source)
    : inferKind(params.error, message)

  return {
    kind,
    toolUseId: params.toolUseId,
    toolName: params.toolName,
    input: toStableJsonValue(params.input),
    message,
    retryable: params.retryable ?? DEFAULT_RETRYABLE[kind],
    repairHint: params.repairHint ?? DEFAULT_REPAIR_HINTS[kind],
  }
}

export function createToolCallRepairSummary(
  params: ToolCallErrorClassifierInput,
): ToolCallRepairSummary {
  return classifyToolCallError(params)
}

function kindFromSource(source: ToolCallErrorSource): ToolCallErrorKind {
  switch (source) {
    case 'input_validation_error':
      return 'schema_error'
    case 'json_parse_error':
      return 'parse_error'
    case 'unknown_tool':
      return 'missing_tool'
    case 'abort_error':
      return 'cancelled'
    default:
      return source
  }
}

function inferKind(error: unknown, message: string): ToolCallErrorKind {
  if (isCancelled(error, message)) {
    return 'cancelled'
  }
  if (isInputValidationError(error, message)) {
    return 'schema_error'
  }
  if (isJsonParseFailure(error, message)) {
    return 'parse_error'
  }
  if (isMissingTool(message)) {
    return 'missing_tool'
  }
  if (isPermissionError(message)) {
    return 'permission_error'
  }
  return 'runtime_error'
}

function normalizeMessage(params: ToolCallErrorClassifierInput): string {
  const rawMessage = params.message ?? messageFromUnknown(params.error)
  const message = rawMessage.trim()
  return message || 'Tool call failed'
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') {
      return message
    }
  }
  if (error === undefined) {
    return ''
  }
  return String(error)
}

function isInputValidationError(error: unknown, message: string): boolean {
  if (/^InputValidationError\b/.test(message)) {
    return true
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return true
  }
  if (!error || typeof error !== 'object' || !('issues' in error)) {
    return false
  }
  const issues = (error as Record<string, unknown>).issues
  return Array.isArray(issues)
}

function isJsonParseFailure(error: unknown, message: string): boolean {
  if (!(error instanceof SyntaxError)) {
    return /JSON\s*parse|parse JSON|invalid JSON/i.test(message)
  }
  return /JSON|Unexpected token|Unexpected end|position \d+/i.test(message)
}

function isMissingTool(message: string): boolean {
  return /No such tool available|Unknown tool|missing tool/i.test(message)
}

function isPermissionError(message: string): boolean {
  return (
    /^Permission denied\b/i.test(message) ||
    /User rejected|not allowed to use|denied by .*permission|permission was denied/i.test(
      message,
    )
  )
}

function isCancelled(error: unknown, message: string): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true
  }
  return /cancelled|canceled|interrupted|user interrupt|streaming fallback/i.test(
    message,
  )
}

function toStableJsonValue(value: unknown): JsonValue {
  return normalizeJsonValue(value, new WeakSet<object>())
}

function normalizeJsonValue(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null) {
    return null
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'bigint':
      return value.toString()
    case 'undefined':
    case 'function':
    case 'symbol':
      return null
    case 'object':
      return normalizeObject(value, seen)
  }
  return null
}

function normalizeObject(value: object, seen: WeakSet<object>): JsonValue {
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    const normalized = value.map(item => normalizeJsonValue(item, seen))
    seen.delete(value)
    return normalized
  }

  const record = value as Record<string, unknown>
  const normalized: { [key: string]: JsonValue } = {}
  for (const key of Object.keys(record).sort()) {
    const item = record[key]
    if (
      item === undefined ||
      typeof item === 'function' ||
      typeof item === 'symbol'
    ) {
      continue
    }
    normalized[key] = normalizeJsonValue(item, seen)
  }
  seen.delete(value)
  return normalized
}
