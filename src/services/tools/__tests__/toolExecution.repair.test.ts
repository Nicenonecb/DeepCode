import { describe, expect, mock, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import { buildTool, type ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage, Message } from '../../../types/message.js'
import type { ToolCallRepairIssue } from '../../toolRepair/types.js'

mock.module('bun:bundle', () => ({ feature: () => false }))

mock.module('../toolHooks.js', () => ({
  resolveHookPermissionDecision: async (
    _hookPermissionResult: unknown,
    _tool: unknown,
    input: Record<string, unknown>,
    _toolUseContext: unknown,
    canUseTool: CanUseToolFn,
    assistantMessage: AssistantMessage,
    toolUseID: string,
  ) => ({
    decision: await canUseTool(
      _tool as never,
      input,
      _toolUseContext as never,
      assistantMessage,
      toolUseID,
    ),
    input,
  }),
  runPostToolUseFailureHooks: async function* () {},
  runPostToolUseHooks: async function* () {},
  runPreToolUseHooks: async function* () {},
}))

const { runToolUse } = await import('../toolExecution.js')

function makeContext(
  tools: ToolUseContext['options']['tools'],
): ToolUseContext {
  const abortController = new AbortController()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { builtinAgents: [], customAgents: [] },
    },
    abortController,
    readFileState: {
      get: () => undefined,
      set: () => {},
      delete: () => false,
      has: () => false,
      clear: () => {},
    },
    getAppState: () =>
      ({
        toolPermissionContext: {
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: true,
        },
        mcp: { clients: [] },
      }) as never,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

function makeAssistantMessage(toolUse: ToolUseBlock): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    message: {
      id: 'msg_test',
      role: 'assistant',
      content: [toolUse],
    },
  } as AssistantMessage
}

async function runSingleToolUse(
  toolUse: ToolUseBlock,
  context: ToolUseContext,
  canUseTool: CanUseToolFn = async () => ({ behavior: 'allow' }),
): Promise<Message> {
  const updates: Message[] = []
  for await (const update of runToolUse(
    toolUse,
    makeAssistantMessage(toolUse),
    canUseTool,
    context,
  )) {
    updates.push(update.message)
  }
  const toolResult = updates.find(message => {
    if (message.type !== 'user' || !message.message) return false
    const content = message.message.content
    return (
      Array.isArray(content) &&
      content.some(
        block =>
          block.type === 'tool_result' && block.tool_use_id === toolUse.id,
      )
    )
  })
  expect(toolResult).toBeDefined()
  return toolResult!
}

function getRepairIssue(message: Message): ToolCallRepairIssue {
  const issue = (message as { toolCallRepairIssue?: ToolCallRepairIssue })
    .toolCallRepairIssue
  expect(issue).toBeDefined()
  return issue!
}

function repairTestTool(options: { call?: () => Promise<{ data: string }> }) {
  return buildTool({
    name: 'RepairTest',
    description: async () => 'repair test',
    prompt: async () => 'repair test',
    inputSchema: z.object({ value: z.string() }),
    call: options.call ?? (async () => ({ data: 'ok' })),
    mapToolResultToToolResultBlockParam: (content, toolUseID) => ({
      type: 'tool_result',
      content: String(content),
      tool_use_id: toolUseID,
    }),
    renderToolUseMessage: () => null,
    renderToolResultMessage: () => null,
    renderToolUseErrorMessage: () => null,
    maxResultSizeChars: 1000,
  })
}

describe('runToolUse repair metadata', () => {
  test('adds schema repair issue for InputValidationError', async () => {
    const tool = repairTestTool({})
    const toolUse = {
      type: 'tool_use',
      caller: { type: 'direct' },
      id: 'toolu_schema',
      name: 'RepairTest',
      input: { value: 123 },
    } satisfies ToolUseBlock

    const message = await runSingleToolUse(toolUse, makeContext([tool]))
    const issue = getRepairIssue(message)

    expect(issue.kind).toBe('schema_error')
    expect(issue.toolUseId).toBe('toolu_schema')
    expect(issue.toolName).toBe('RepairTest')
    expect(issue.retryable).toBe(true)
    expect(issue.input).toEqual({ value: 123 })
    expect(issue.message).toContain('InputValidationError')
  })

  test('adds missing_tool repair issue for unknown tools', async () => {
    const toolUse = {
      type: 'tool_use',
      caller: { type: 'direct' },
      id: 'toolu_missing',
      name: 'MissingTool',
      input: { value: 'x' },
    } satisfies ToolUseBlock

    const message = await runSingleToolUse(toolUse, makeContext([]))
    const issue = getRepairIssue(message)

    expect(issue.kind).toBe('missing_tool')
    expect(issue.toolName).toBe('MissingTool')
    expect(issue.retryable).toBe(true)
    expect(message.toolUseResult).toBe(
      'Error: No such tool available: MissingTool',
    )
  })

  test('adds runtime repair issue for tool exceptions', async () => {
    const tool = repairTestTool({
      call: async () => {
        throw new Error('runtime boom')
      },
    })
    const toolUse = {
      type: 'tool_use',
      caller: { type: 'direct' },
      id: 'toolu_runtime',
      name: 'RepairTest',
      input: { value: 'ok' },
    } satisfies ToolUseBlock

    const message = await runSingleToolUse(toolUse, makeContext([tool]))
    const issue = getRepairIssue(message)

    expect(issue.kind).toBe('runtime_error')
    expect(issue.toolUseId).toBe('toolu_runtime')
    expect(issue.input).toEqual({ value: 'ok' })
    expect(issue.retryable).toBe(false)
    expect(issue.message).toBe('runtime boom')
  })

  test('adds permission repair issue for permission rejection', async () => {
    const tool = repairTestTool({})
    const toolUse = {
      type: 'tool_use',
      caller: { type: 'direct' },
      id: 'toolu_permission',
      name: 'RepairTest',
      input: { value: 'ok' },
    } satisfies ToolUseBlock

    const message = await runSingleToolUse(
      toolUse,
      makeContext([tool]),
      async () => ({
        behavior: 'deny',
        message: 'Permission denied',
        decisionReason: { type: 'mode', mode: 'default' },
      }),
    )
    const issue = getRepairIssue(message)

    expect(issue.kind).toBe('permission_error')
    expect(issue.toolUseId).toBe('toolu_permission')
    expect(issue.input).toEqual({ value: 'ok' })
    expect(issue.retryable).toBe(false)
    expect(message.toolUseResult).toBe('Error: Permission denied')
  })
})
