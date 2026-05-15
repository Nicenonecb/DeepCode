export type ToolCallErrorKind =
  | 'parse_error'
  | 'schema_error'
  | 'permission_error'
  | 'runtime_error'
  | 'missing_tool'
  | 'cancelled'

export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export type ToolCallErrorSource =
  | ToolCallErrorKind
  | 'input_validation_error'
  | 'json_parse_error'
  | 'unknown_tool'
  | 'abort_error'

export type ToolCallErrorClassifierInput = {
  toolUseId: string
  toolName: string
  input: unknown
  error?: unknown
  message?: string
  source?: ToolCallErrorSource
  retryable?: boolean
  repairHint?: string
}

export type ToolCallRepairIssue = {
  kind: ToolCallErrorKind
  toolUseId: string
  toolName: string
  input: JsonValue
  message: string
  retryable: boolean
  repairHint: string
}

export type ToolCallRepairSummary = ToolCallRepairIssue
