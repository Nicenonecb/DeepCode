export {
  parseDSMLToolCalls,
  unescapeDSMLText,
} from './parser.js'
export {
  dsmlToolCallsToOpenAI,
  escapeDSMLText,
  openAIToolCallsToDSML,
  serializeDSMLToolCalls,
} from './serializer.js'
export {
  buildDSMLToolSchemaPrompt,
  shouldUseDSMLGateway,
} from './gateway.js'
export type {
  DSMLGatewaySettings,
  DSMLOpenAIToolCall,
  DSMLParseError,
  DSMLParseResult,
  DSMLSerializeOptions,
  DSMLTagStyle,
  DSMLToolCall,
  DSMLToolInput,
  DSMLValue,
} from './types.js'
