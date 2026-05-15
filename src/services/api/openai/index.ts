import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.mjs'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import type {
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  AssistantMessage,
  UserMessage,
} from '../../../types/message.js'
import type { AgentId } from '../../../types/ids.js'
import type { Tools } from '../../../Tool.js'
import { getOpenAIClient } from './client.js'
import {
  anthropicMessagesToOpenAI,
  adaptOpenAIStreamToAnthropic,
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} from '@ant/model-provider'
import { resolveOpenAICompatEnv, resolveOpenAICompatModel } from './env.js'
import { isChatGPTAuthEnabled } from './chatgptAuth.js'
import {
  adaptResponsesStreamToAnthropic,
  buildResponsesRequest,
  createChatGPTResponsesStream,
  type ResponsesReasoningEffort,
} from './responsesAdapter.js'
import { normalizeMessagesForAPI } from '../../../utils/messages.js'
import { toolToAPISchema } from '../../../utils/api.js'
import {
  getEmptyToolPermissionContext,
  toolMatchesName,
} from '../../../Tool.js'
import { logForDebugging } from '../../../utils/debug.js'
import { addToTotalSessionCost } from '../../../cost-tracker.js'
import { calculateUSDCost } from '../../../utils/modelCost.js'
import {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
} from './requestBody.js'
import { applyDeepSeekMaxPromptPatch } from '../../deepseek/maxPrompt.js'
import { resolveDeepSeekRequestEffortProfile } from '../../deepseek/modelProfiles.js'
import { recordLLMObservation } from '../../../services/langfuse/tracing.js'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
  convertToolsToLangfuse,
} from '../../../services/langfuse/convert.js'
export {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
}
import { getModelMaxOutputTokens } from '../../../utils/context.js'
import type { Options } from '../claude.js'
import { randomUUID } from 'crypto'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import {
  isSearchExtraToolsEnabled,
  isDeferredToolsDeltaEnabled,
} from '../../../utils/searchExtraTools.js'
import {
  formatDeferredToolLine,
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@deepcode/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { applyDSMLRequestGateway } from './dsmlRequest.js'
import {
  applyDSMLResponseGateway,
  createDSMLToolUseId,
  type DSMLResponseGatewayResult,
} from './dsmlResponse.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../analytics/index.js'

function convertToResponsesReasoningEffort(
  effortValue: unknown,
): ResponsesReasoningEffort | undefined {
  if (effortValue === 'low') return 'low'
  if (effortValue === 'medium') return 'medium'
  if (effortValue === 'high') return 'high'
  if (effortValue === 'xhigh' || effortValue === 'max') return 'xhigh'
  if (typeof effortValue === 'number') return 'high'
  return undefined
}

function getChatGPTResponsesReasoningEffort(
  effortValue: unknown,
): ResponsesReasoningEffort | undefined {
  const envOverride = process.env.CLAUDE_CODE_EFFORT_LEVEL?.toLowerCase()
  if (envOverride === 'auto' || envOverride === 'unset') return undefined
  return (
    convertToResponsesReasoningEffort(envOverride) ??
    convertToResponsesReasoningEffort(effortValue) ??
    'medium'
  )
}

/**
 * Mirrors the Anthropic request path's deferred-tool announcement for OpenAI.
 *
 * OpenAI-compatible endpoints cannot consume Anthropic's `defer_loading` or
 * `tool_reference` beta payloads directly, so the model needs the same textual
 * list of deferred MCP tool names that Anthropic receives before it can ask
 * SearchExtraToolsTool to load their full schemas.
 */
function prependDeferredToolListIfNeeded(
  messages: (AssistantMessage | UserMessage)[],
  tools: Tools,
  deferredToolNames: Set<string>,
  useSearchExtraTools: boolean,
): (AssistantMessage | UserMessage)[] {
  if (!useSearchExtraTools || isDeferredToolsDeltaEnabled()) return messages

  const deferredToolList = tools
    .filter(tool => deferredToolNames.has(tool.name))
    .map(formatDeferredToolLine)
    .sort()
    .join('\n')

  if (!deferredToolList) return messages

  return [
    createUserMessage({
      content: `<available-deferred-tools>\n${deferredToolList}\n</available-deferred-tools>`,
      isMeta: true,
    }),
    ...messages,
  ]
}

function isOpenAIConvertibleMessage(
  msg: Message,
): msg is AssistantMessage | UserMessage {
  return msg.type === 'assistant' || msg.type === 'user'
}

/**
 * Assemble the final AssistantMessage (and optional max_tokens error) from
 * accumulated stream state. Extracted to avoid duplication between the
 * `message_stop` handler and the post-loop safety fallback.
 */
function assembleFinalAssistantOutputs(params: {
  partialMessage: any
  contentBlocks: Record<number, any>
  tools: Tools
  agentId: string | undefined
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  stopReason: string | null
  maxTokens: number
  dsmlGateway: Options['dsmlGateway']
  onDSMLResponse?: (result: DSMLResponseGatewayResult) => void
}): (AssistantMessage | SystemAPIErrorMessage)[] {
  const {
    partialMessage,
    contentBlocks,
    tools,
    agentId,
    usage,
    stopReason,
    maxTokens,
    dsmlGateway,
  } = params
  const outputs: (AssistantMessage | SystemAPIErrorMessage)[] = []

  const rawBlocks = Object.keys(contentBlocks)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => contentBlocks[Number(k)])
    .filter(Boolean)
  const dsmlResponse = applyDSMLResponseGateway({
    contentBlocks: rawBlocks,
    settings: dsmlGateway,
    createToolUseId: createDSMLToolUseId,
    knownToolNames: new Set(tools.map(tool => tool.name)),
  })
  params.onDSMLResponse?.(dsmlResponse)
  const allBlocks = dsmlResponse.contentBlocks
  const effectiveStopReason = dsmlResponse.hasToolUse ? 'tool_use' : stopReason

  if (allBlocks.length > 0) {
    outputs.push({
      message: {
        ...partialMessage,
        content: normalizeContentFromAPI(
          allBlocks,
          tools,
          agentId as AgentId | undefined,
        ),
        usage,
        stop_reason: effectiveStopReason,
        stop_sequence: null,
      },
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    } as AssistantMessage)
  }

  if (stopReason === 'max_tokens') {
    outputs.push(
      createAssistantAPIErrorMessage({
        content:
          `Output truncated: response exceeded the ${maxTokens} token limit. ` +
          `Set OPENAI_MAX_TOKENS or CLAUDE_CODE_MAX_OUTPUT_TOKENS to override.`,
        apiError: 'max_output_tokens',
        error: 'max_output_tokens',
      }),
    )
  }

  return outputs
}

/**
 * OpenAI-compatible query path. Converts Anthropic-format messages/tools to
 * OpenAI format, calls the OpenAI-compatible endpoint, and converts the
 * SSE stream back to Anthropic BetaRawMessageStreamEvent for consumption
 * by the existing query pipeline.
 */
export async function* queryModelOpenAI(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
  thinkingConfig?: ThinkingConfig,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    // 1. Resolve model name
    const openaiModel = resolveOpenAICompatModel(options.model)
    const openaiCompatEnv = resolveOpenAICompatEnv()

    // 2. Normalize messages using shared preprocessing
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)

    // 3. Check if tool search is enabled (similar to Anthropic path)
    const useSearchExtraTools = await isSearchExtraToolsEnabled(
      options.model,
      tools,
      options.getToolPermissionContext ||
        (async () => getEmptyToolPermissionContext()),
      options.agents || [],
      options.querySource,
    )

    // 4. Build deferred tools set (similar to Anthropic path)
    const deferredToolNames = new Set<string>()
    if (useSearchExtraTools) {
      for (const t of tools) {
        if (isDeferredTool(t)) deferredToolNames.add(t.name)
      }
    }

    // 5. Filter tools (similar to Anthropic path)
    // Never include deferred tools in the API tools array — they are invoked
    // via ExecuteExtraTool which looks them up from the global tool registry
    // at runtime. Keeping the tools array stable preserves the prompt cache.
    let filteredTools = tools
    if (useSearchExtraTools && deferredToolNames.size > 0) {
      filteredTools = tools.filter(tool => {
        // Always include non-deferred tools
        if (!deferredToolNames.has(tool.name)) return true
        // Always include SearchExtraToolsTool (so it can discover more tools)
        if (toolMatchesName(tool, SEARCH_EXTRA_TOOLS_TOOL_NAME)) return true
        // All other deferred tools are excluded — use ExecuteExtraTool instead
        return false
      })
    }

    // 6. Build tool schemas with deferLoading flag
    const toolSchemas = await Promise.all(
      filteredTools.map(tool =>
        toolToAPISchema(tool, {
          getToolPermissionContext: options.getToolPermissionContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model: options.model,
          deferLoading: useSearchExtraTools && deferredToolNames.has(tool.name),
        }),
      ),
    )

    // 7. Filter out non-standard tools (server tools like advisor)
    const standardTools = toolSchemas.filter(
      (t): t is BetaToolUnion & { type: string } => {
        const anyT = t as unknown as Record<string, unknown>
        return (
          anyT.type !== 'advisor_20260301' && anyT.type !== 'computer_20250124'
        )
      },
    )

    // 8. Convert messages and tools to OpenAI format
    const requestEffortValue =
      thinkingConfig?.type === 'disabled' ? 'low' : options.effortValue
    const enableThinking =
      thinkingConfig?.type === 'disabled'
        ? false
        : isOpenAIThinkingEnabled(openaiModel, options.effortValue)
    const openAIConvertibleMessages = messagesForAPI.filter(
      isOpenAIConvertibleMessage,
    )
    const messagesWithDeferredToolList = prependDeferredToolListIfNeeded(
      openAIConvertibleMessages,
      tools,
      deferredToolNames,
      useSearchExtraTools,
    )
    const nativeOpenAITools = anthropicToolsToOpenAI(standardTools)
    const nativeOpenAIToolChoice = anthropicToolChoiceToOpenAI(
      options.toolChoice,
    )
    const requestToolProtocol = applyDSMLRequestGateway({
      model: openaiModel,
      baseURL: openaiCompatEnv.baseURL,
      messages: messagesWithDeferredToolList,
      standardTools: standardTools as unknown as Array<Record<string, unknown>>,
      nativeTools: nativeOpenAITools,
      nativeToolChoice: nativeOpenAIToolChoice,
      settings: options.dsmlGateway,
      createMetaMessage: content =>
        createUserMessage({
          content,
          isMeta: true,
        }),
    })
    const deepSeekEffortProfile = resolveDeepSeekRequestEffortProfile(
      openaiModel,
      requestEffortValue,
      options.deepSeekEffortBudgets,
    )
    const maxPromptPatch = applyDeepSeekMaxPromptPatch({
      model: openaiModel,
      effortProfile: deepSeekEffortProfile,
      enableThinking,
      systemPrompt,
      messages: requestToolProtocol.messages,
    })
    const openaiMessages = anthropicMessagesToOpenAI(
      requestToolProtocol.messages,
      maxPromptPatch.systemPrompt,
      {
        enableThinking,
        interleavedThinkingRetention: options.deepSeekInterleavedThinking,
      },
    )
    const openaiTools = requestToolProtocol.tools
    const openaiToolChoice = requestToolProtocol.toolChoice
    const effectiveDSMLGatewaySettings: Options['dsmlGateway'] =
      requestToolProtocol.enabled
        ? {
            ...options.dsmlGateway,
            enabled: true,
          }
        : {
            ...options.dsmlGateway,
            enabled: false,
          }
    const dsmlMetrics = {
      request: requestToolProtocol.metrics,
      response: {
        parseAttemptCount: 0,
        parseErrorCount: 0,
        parsedToolUseCount: 0,
        fallbackToTextCount: 0,
        unknownToolCount: 0,
      },
    }
    const observeDSMLResponse = (result: DSMLResponseGatewayResult): void => {
      dsmlMetrics.response.parseAttemptCount += result.parseAttemptCount
      dsmlMetrics.response.parseErrorCount += result.parseErrorCount
      dsmlMetrics.response.parsedToolUseCount += result.toolUseCount
      dsmlMetrics.response.unknownToolCount += result.unknownToolCount
      if (result.fellBackToText) dsmlMetrics.response.fallbackToTextCount++
    }
    const reasoningEffort = getChatGPTResponsesReasoningEffort(
      options.effortValue,
    )

    // 9. Log tool filtering details
    if (useSearchExtraTools) {
      const includedDeferredTools = filteredTools.filter(t =>
        deferredToolNames.has(t.name),
      ).length
      logForDebugging(
        `[OpenAI] Tool search enabled: ${includedDeferredTools}/${deferredToolNames.size} deferred tools included, total tools=${openaiTools.length}`,
      )
    } else {
      logForDebugging(
        `[OpenAI] Tool search disabled, total tools=${openaiTools.length}`,
      )
    }

    // 10. Compute max_tokens — required by most OpenAI-compatible endpoints.
    //     Without this the server uses a tiny default, and when
    //     thinking is enabled the thinking phase consumes the entire budget
    //     leaving no tokens for the final response.
    //
    //     Use upperLimit (not the slot-cap default) because the Anthropic path's
    //     slot-reservation cap (CAPPED_DEFAULT_MAX_TOKENS=8k) is paired with an
    //     auto-retry at 64k in query.ts. The OpenAI path has no such retry, so
    //     using the capped 8k default would silently truncate responses in
    //     multi-turn conversations where thinking consumes most of the budget.
    //
    //     Override priority:
    //     1. options.maxOutputTokensOverride (programmatic)
    //     2. OPENAI_MAX_TOKENS env var (OpenAI-specific, useful for local models
    //        with small context windows, e.g. RTX 3060 12GB running 65536-token models)
    //     3. CLAUDE_CODE_MAX_OUTPUT_TOKENS env var (generic override)
    //     4. upperLimit default (64000)
    const { upperLimit } = getModelMaxOutputTokens(openaiModel)
    const maxTokens = resolveOpenAIMaxTokens(
      upperLimit,
      options.maxOutputTokensOverride,
    )
    logForDebugging(
      `[OpenAI] Calling model=${openaiModel}, messages=${openaiMessages.length}, tools=${openaiTools.length}, thinking=${enableThinking}, effortTier=${deepSeekEffortProfile?.tier ?? 'default'}, reasoningEffort=${deepSeekEffortProfile?.reasoningEffort ?? 'none'}, maxTokens=${deepSeekEffortProfile ? Math.min(maxTokens, deepSeekEffortProfile.maxOutputTokens) : maxTokens}, maxReasoningTokens=${deepSeekEffortProfile?.maxReasoningTokens ?? 'n/a'}, maxContextTokens=${deepSeekEffortProfile?.maxContextTokens ?? 'n/a'}, contextWatermark=${deepSeekEffortProfile?.contextWatermark ?? 'n/a'}, maxPromptInjected=${maxPromptPatch.injected}, toolProtocol=${requestToolProtocol.decision.toolProtocol}, dsmlSource=${requestToolProtocol.decision.source}${requestToolProtocol.decision.fallbackReason ? `, dsmlFallback=${requestToolProtocol.decision.fallbackReason}` : ''}`,
    )
    logEvent('tengu_dsml_gateway_request', {
      model:
        openaiModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      tool_protocol: requestToolProtocol.decision
        .toolProtocol as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: requestToolProtocol.decision
        .source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      fallback_reason: (requestToolProtocol.decision.fallbackReason ??
        'none') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      provider_evidence: requestToolProtocol.decision
        .providerEvidence as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      standard_tool_count: requestToolProtocol.metrics.standardToolCount,
      native_tool_count: requestToolProtocol.metrics.nativeToolCount,
      prompt_chars: requestToolProtocol.metrics.promptChars,
      effort_tier: (deepSeekEffortProfile?.tier ??
        'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reasoning_effort: (deepSeekEffortProfile?.reasoningEffort ??
        'none') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      max_output_tokens: deepSeekEffortProfile
        ? Math.min(maxTokens, deepSeekEffortProfile.maxOutputTokens)
        : maxTokens,
      max_reasoning_tokens: deepSeekEffortProfile?.maxReasoningTokens ?? 0,
      max_context_tokens: deepSeekEffortProfile?.maxContextTokens ?? 0,
      context_watermark: deepSeekEffortProfile?.contextWatermark ?? 0,
      max_prompt_injected: maxPromptPatch.injected,
      max_prompt_conflict_policy:
        maxPromptPatch.conflictPolicy as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // 11. Call OpenAI API with streaming. ChatGPT subscription auth uses the
    // Codex Responses backend; API-key/OpenAI-compatible auth keeps the
    // existing Chat Completions adapter.
    const adaptedStream = isChatGPTAuthEnabled()
      ? adaptResponsesStreamToAnthropic(
          await createChatGPTResponsesStream({
            request: buildResponsesRequest({
              model: openaiModel,
              messages: openaiMessages,
              tools: openaiTools,
              toolChoice: openaiToolChoice,
              reasoningEffort,
            }),
            signal,
            fetchOverride: options.fetchOverride as unknown as typeof fetch,
          }),
          openaiModel,
        )
      : adaptOpenAIStreamToAnthropic(
          await getOpenAIClient({
            maxRetries: 0,
            fetchOverride: options.fetchOverride as unknown as typeof fetch,
            source: options.querySource,
          }).chat.completions.create(
            buildOpenAIRequestBody({
              model: openaiModel,
              messages: openaiMessages,
              tools: openaiTools,
              toolChoice: openaiToolChoice,
              enableThinking,
              maxTokens,
              temperatureOverride: options.temperatureOverride,
              effortValue: requestEffortValue,
              effortBudgetSettings: options.deepSeekEffortBudgets,
            }) as unknown as ChatCompletionCreateParamsStreaming,
            { signal },
          ),
          openaiModel,
        )

    // 12. Convert OpenAI stream to Anthropic events, then process into
    //     AssistantMessage + StreamEvent (matching the Anthropic path behavior)

    // Accumulate content blocks and usage, same as the Anthropic path in claude.ts
    const contentBlocks: Record<number, any> = {}
    const collectedMessages: AssistantMessage[] = []
    let partialMessage: any
    let stopReason: string | null = null
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    let ttftMs = 0
    const start = Date.now()

    for await (const event of adaptedStream) {
      switch (event.type) {
        case 'message_start': {
          partialMessage = (event as any).message
          ttftMs = Date.now() - start
          if ((event as any).message?.usage) {
            usage = {
              ...usage,
              ...(event as any).message.usage,
            }
          }
          break
        }
        case 'content_block_start': {
          const idx = (event as any).index
          const cb = (event as any).content_block
          if (cb.type === 'tool_use') {
            contentBlocks[idx] = { ...cb, input: '' }
          } else if (cb.type === 'text') {
            contentBlocks[idx] = { ...cb, text: '' }
          } else if (cb.type === 'thinking') {
            contentBlocks[idx] = { ...cb, thinking: '', signature: '' }
          } else {
            contentBlocks[idx] = { ...cb }
          }
          break
        }
        case 'content_block_delta': {
          const idx = (event as any).index
          const delta = (event as any).delta
          const block = contentBlocks[idx]
          if (!block) break
          if (delta.type === 'text_delta') {
            block.text = (block.text || '') + delta.text
          } else if (delta.type === 'input_json_delta') {
            block.input = (block.input || '') + delta.partial_json
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + delta.thinking
          } else if (delta.type === 'signature_delta') {
            block.signature = delta.signature
          }
          break
        }
        case 'content_block_stop': {
          // Block accumulation is complete; assembly happens at message_stop.
          break
        }
        case 'message_delta': {
          const deltaUsage = (event as any).usage
          if (deltaUsage) {
            usage = { ...usage, ...deltaUsage }
          }
          if ((event as any).delta?.stop_reason != null) {
            stopReason = (event as any).delta.stop_reason
          }
          break
        }
        case 'message_stop': {
          // Assemble ONE AssistantMessage with ALL content blocks, matching the
          // Anthropic SDK path. Real usage (input + output tokens) is available
          // here and injected so tokenCountWithEstimation() can read it.
          if (partialMessage) {
            for (const output of assembleFinalAssistantOutputs({
              partialMessage,
              contentBlocks,
              tools,
              agentId: options.agentId,
              dsmlGateway: effectiveDSMLGatewaySettings,
              onDSMLResponse: observeDSMLResponse,
              usage,
              stopReason,
              maxTokens,
            })) {
              if (output.type === 'assistant') {
                collectedMessages.push(output)
              }
              yield output
            }
            // Reset partialMessage so the post-loop safety fallback does not
            // yield a second identical AssistantMessage.
            partialMessage = null
          }
          // Track cost and token usage
          if (usage.input_tokens + usage.output_tokens > 0) {
            const costUSD = calculateUSDCost(openaiModel, usage as any)
            addToTotalSessionCost(costUSD, usage as any, options.model)
          }
          break
        }
      }

      // Also yield as StreamEvent for real-time display (matching Anthropic path)
      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as StreamEvent
    }

    // Record LLM observation in Langfuse (no-op if not configured)
    recordLLMObservation(options.langfuseTrace ?? null, {
      model: openaiModel,
      provider: 'openai',
      input: convertMessagesToLangfuse(openaiMessages),
      output: convertOutputToLangfuse(collectedMessages),
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
      },
      startTime: new Date(start),
      endTime: new Date(),
      completionStartTime: ttftMs > 0 ? new Date(start + ttftMs) : undefined,
      tools: convertToolsToLangfuse(toolSchemas as unknown[]),
      ...(enableThinking && { thinking: { type: 'enabled' } }),
      metadata: {
        toolProtocol: requestToolProtocol.decision.toolProtocol,
        dsmlGateway: dsmlMetrics,
        deepSeekEffortProfile,
        deepSeekMaxPromptPatch: {
          injected: maxPromptPatch.injected,
          conflictPolicy: maxPromptPatch.conflictPolicy,
        },
      },
    })

    // Safety: if stream ended without message_stop, assemble and yield whatever we have
    if (partialMessage) {
      for (const output of assembleFinalAssistantOutputs({
        partialMessage,
        contentBlocks,
        tools,
        agentId: options.agentId,
        dsmlGateway: effectiveDSMLGatewaySettings,
        onDSMLResponse: observeDSMLResponse,
        usage,
        stopReason,
        maxTokens,
      })) {
        yield output
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logForDebugging(`[OpenAI] Error: ${errorMessage}`, { level: 'error' })
    yield createAssistantAPIErrorMessage({
      content: `API Error: ${errorMessage}`,
      apiError: 'api_error',
      error: (error instanceof Error
        ? error
        : new Error(String(error))) as unknown as SDKAssistantMessageError,
    })
  }
}
