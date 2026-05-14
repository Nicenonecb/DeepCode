import {
  buildDSMLToolSchemaPrompt,
  shouldUseDSMLGateway,
  type DSMLGatewaySettings,
} from '../../dsml/index.js'

type DSMLToolSchema = Record<string, unknown>

export type DSMLRequestGatewayResult<TMessage, TToolChoice> = {
  messages: TMessage[]
  tools: unknown[]
  toolChoice: TToolChoice | undefined
  enabled: boolean
}

export function applyDSMLRequestGateway<TMessage, TToolChoice>(params: {
  messages: TMessage[]
  standardTools: DSMLToolSchema[]
  nativeTools: unknown[]
  nativeToolChoice: TToolChoice | undefined
  settings: DSMLGatewaySettings | undefined
  createMetaMessage: (content: string) => TMessage
}): DSMLRequestGatewayResult<TMessage, TToolChoice> {
  if (!shouldUseDSMLGateway(params.settings)) {
    return {
      messages: params.messages,
      tools: params.nativeTools,
      toolChoice: params.nativeToolChoice,
      enabled: false,
    }
  }

  const prompt = buildDSMLToolSchemaPrompt(
    params.standardTools,
    params.settings,
  )

  return {
    messages: prompt
      ? [params.createMetaMessage(prompt), ...params.messages]
      : params.messages,
    tools: [],
    toolChoice: undefined,
    enabled: true,
  }
}
