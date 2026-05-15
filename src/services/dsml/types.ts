export type DSMLValue =
  | string
  | number
  | boolean
  | null
  | DSMLValue[]
  | { [key: string]: DSMLValue }

export type DSMLToolInput = Record<string, DSMLValue>

export type DSMLToolCall = {
  id?: string
  name: string
  input: DSMLToolInput
}

export type DSMLParseError = {
  message: string
  offset: number
  raw: string
}

export type DSMLParseResult = {
  raw: string
  prefix: string
  suffix: string
  toolCalls: DSMLToolCall[]
  errors: DSMLParseError[]
}

export type DSMLTagStyle = 'fullwidth' | 'ascii'

export type DSMLSerializeOptions = {
  tagStyle?: DSMLTagStyle
}

export type DSMLGatewaySettings = {
  enabled?: boolean
  tagStyle?: DSMLTagStyle
  maxPromptChars?: number
  malformedResponseStrategy?: 'text' | 'tool_use'
}

export type DSMLOpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
