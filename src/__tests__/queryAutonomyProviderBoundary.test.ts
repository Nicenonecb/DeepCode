import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../bootstrap/state'
import { query } from '../query'
import { createWorkingMemory } from '../services/workingMemory/index'
import { buildTool, getEmptyToolPermissionContext } from '../Tool'
import type { WorkingMemory } from '../services/workingMemory/index'
import type { AssistantMessage } from '../types/message'
import { createAttachmentMessage } from '../utils/attachments'
import { asSystemPrompt } from '../utils/systemPromptType'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
} from '../utils/messages'
import {
  cleanupTempDir,
  createTempDir,
  writeTempFile,
} from '../../tests/mocks/file-system'
import {
  enqueue,
  getCommandsByMaxPriority,
  resetCommandQueue,
} from '../utils/messageQueueManager'
import { getAutonomyFlowById, listAutonomyFlows } from '../utils/autonomyFlows'
import {
  getAutonomyRunById,
  startManagedAutonomyFlowFromHeartbeatTask,
} from '../utils/autonomyRuns'
import { z } from 'zod/v4'

let tempDir = ''
let originalProcessCwd = ''

beforeEach(async () => {
  originalProcessCwd = process.cwd()
  tempDir = await createTempDir('query-autonomy-provider-boundary-')
  resetStateForTests()
  resetCommandQueue()
  setOriginalCwd(tempDir)
  setCwdState(tempDir)
  setProjectRoot(tempDir)
})

afterEach(async () => {
  resetStateForTests()
  resetCommandQueue()
  if (originalProcessCwd) {
    process.chdir(originalProcessCwd)
  }
  if (tempDir) {
    let lastError: unknown
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await cleanupTempDir(tempDir)
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    if (lastError) {
      throw lastError
    }
  }
})

function createToolUseAssistantMessage(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: 'msg_tool_use',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'tool_use',
          id: 'toolu_provider_boundary',
          name: 'MissingBoundaryTool',
          input: {},
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createMultiToolUseAssistantMessage(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: 'msg_multi_tool_use',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'tool_use',
          caller: { type: 'direct' },
          id: 'toolu_success',
          name: 'RepairSuccess',
          input: { value: 'ok' },
        },
        {
          type: 'tool_use',
          caller: { type: 'direct' },
          id: 'toolu_schema_retryable',
          name: 'RepairNeedsString',
          input: { value: 123 },
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createSchemaRepairToolUseAssistantMessage(
  toolUseId: string,
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_schema_repair_${toolUseId}`,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'tool_use',
          caller: { type: 'direct' },
          id: toolUseId,
          name: 'RepairNeedsString',
          input: { value: 123 },
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createRepairSuccessTool() {
  return buildTool({
    name: 'RepairSuccess',
    description: async () => 'repair success test',
    prompt: async () => 'repair success test',
    inputSchema: z.object({ value: z.string() }),
    call: async () => ({ data: 'success-result' }),
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

function createRepairNeedsStringTool() {
  return buildTool({
    name: 'RepairNeedsString',
    description: async () => 'repair schema test',
    prompt: async () => 'repair schema test',
    inputSchema: z.object({ value: z.string() }),
    call: async () => ({ data: 'should-not-run' }),
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

function createTextAssistantMessage(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'text',
          text,
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createToolUseContext({
  isNonInteractiveSession = true,
  settings = {},
  workingMemory,
  mainLoopModel = 'claude-sonnet-4-5-20250929',
  effortValue,
}: {
  isNonInteractiveSession?: boolean
  settings?: Record<string, unknown>
  workingMemory?: WorkingMemory
  mainLoopModel?: string
  effortValue?: unknown
} = {}): any {
  let inProgressToolUseIds = new Set<string>()
  let responseLength = 0
  let appState = {
    settings,
    workingMemory,
    toolPermissionContext: getEmptyToolPermissionContext(),
    fastMode: false,
    mcp: {
      tools: [],
      clients: [],
    },
    effortValue,
    advisorModel: undefined,
    sessionHooks: new Map(),
  }

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel,
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession,
      agentDefinitions: {
        activeAgents: [],
        allowedAgentTypes: [],
      },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => appState,
    setAppState: (updater: (state: any) => any) => {
      appState = updater(appState as never)
    },
    setInProgressToolUseIDs: (updater: (state: Set<string>) => Set<string>) => {
      inProgressToolUseIds = updater(inProgressToolUseIds)
    },
    setResponseLength: (updater: (state: number) => number) => {
      responseLength = updater(responseLength)
    },
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as any
}

describe('query autonomy/provider boundary', () => {
  test('feeds retryable tool repair summary into the next model pass without rerunning successful tools', async () => {
    const toolUseContext = createToolUseContext()
    const successTool = createRepairSuccessTool()
    const schemaTool = createRepairNeedsStringTool()
    toolUseContext.options.tools = [successTool, schemaTool]

    const modelInputs: unknown[] = []
    let callCount = 0
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        modelInputs.push(messages)
        yield callCount === 1
          ? createMultiToolUseAssistantMessage()
          : createTextAssistantMessage('repair summary received')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'run two tools',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(2)

    const serializedSecondInput = JSON.stringify(modelInputs[1])
    expect(serializedSecondInput).toContain('<tool_call_repair>')
    expect(serializedSecondInput).toContain('RepairNeedsString')
    expect(serializedSecondInput).toContain('toolu_schema_retryable')
    expect(serializedSecondInput).toContain('schema_error')
    expect(serializedSecondInput).toContain('Do not rerun tool calls')
    expect(serializedSecondInput).toContain('<successful_tools_do_not_rerun>')
    expect(serializedSecondInput).toContain('toolu_success: RepairSuccess')

    type CapturedModelMessage = {
      message?: { content?: string | Array<{ text?: unknown }> }
    }
    const repairMessage = (modelInputs[1] as CapturedModelMessage[])
      .flatMap(message => {
        const content = message.message?.content
        if (typeof content === 'string') return [content]
        if (Array.isArray(content)) {
          return content
            .map(block => block.text)
            .filter((text): text is string => typeof text === 'string')
        }
        return []
      })
      .find(text => text.includes('<tool_call_repair>'))

    expect(repairMessage).toContain('RepairNeedsString')
    expect(repairMessage).not.toContain('success-result')
  })

  test('auto-starts Patch Search for complex retryable repair without the env gate', async () => {
    const originalAutotrigger = process.env.DEEPCODE_PATCH_SEARCH_AUTOTRIGGER
    delete process.env.DEEPCODE_PATCH_SEARCH_AUTOTRIGGER

    try {
      const toolUseContext = createToolUseContext()
      const schemaTool = createRepairNeedsStringTool()
      toolUseContext.options.tools = [schemaTool]

      const patchSearchRequests: unknown[] = []
      let callCount = 0
      const deps = {
        uuid: () => 'query-chain-id',
        microcompact: async (messages: unknown[]) => ({ messages }),
        autocompact: async () => ({
          compactionResult: undefined,
          consecutiveFailures: 0,
        }),
        patchSearchForHighRiskContext: async (context: unknown) => {
          patchSearchRequests.push(context)
          const setAppState = (
            context as {
              toolUseContext?: {
                setAppState?: (updater: (state: any) => any) => void
              }
            }
          ).toolUseContext?.setAppState
          setAppState?.(state => ({
            ...state,
            patchSearchStatus: {
              phase: 'completed',
              requestId: 'patch-search-query-test',
              candidateCount: 2,
              runningCount: 0,
              verifyingCount: 0,
              failedCount: 0,
              selectedCandidateId: 'candidate-1',
              updatedAt: 123,
            },
          }))
          return undefined
        },
        callModel: async function* () {
          callCount += 1
          yield callCount === 1
            ? createSchemaRepairToolUseAssistantMessage('toolu_complex_repair')
            : createTextAssistantMessage('patch search status observed')
        },
      }

      const generator = query({
        messages: [
          createUserMessage({
            content:
              'debug and refactor this complex failing provider boundary',
          }),
        ],
        systemPrompt: asSystemPrompt([]),
        userContext: {},
        systemContext: {},
        canUseTool: async (_tool, input) => ({
          behavior: 'allow',
          updatedInput: input,
        }),
        toolUseContext,
        querySource: 'sdk',
        maxTurns: 3,
        deps: deps as never,
      })

      let next = await generator.next()
      while (!next.done) {
        next = await generator.next()
      }

      expect(next.value.reason).toBe('completed')
      expect(patchSearchRequests).toHaveLength(1)
      expect(patchSearchRequests[0]).toMatchObject({
        source: 'query',
        prompt: 'debug and refactor this complex failing provider boundary',
        repairIssues: [
          {
            toolUseId: 'toolu_complex_repair',
            toolName: 'RepairNeedsString',
            retryable: true,
          },
        ],
      })
      expect(toolUseContext.getAppState().patchSearchStatus).toMatchObject({
        phase: 'completed',
        selectedCandidateId: 'candidate-1',
      })
    } finally {
      if (originalAutotrigger === undefined) {
        delete process.env.DEEPCODE_PATCH_SEARCH_AUTOTRIGGER
      } else {
        process.env.DEEPCODE_PATCH_SEARCH_AUTOTRIGGER = originalAutotrigger
      }
    }
  })

  test('stops feeding repair summary after the tool-name retry budget is exhausted', async () => {
    const toolUseContext = createToolUseContext()
    const schemaTool = createRepairNeedsStringTool()
    toolUseContext.options.tools = [schemaTool]

    const modelInputs: unknown[] = []
    let callCount = 0
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        modelInputs.push(messages)
        yield callCount <= 3
          ? createSchemaRepairToolUseAssistantMessage(
              `toolu_schema_retry_${callCount}`,
            )
          : createTextAssistantMessage('repair budget exhausted')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'keep retrying the same invalid tool',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 5,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(4)

    const secondInput = JSON.stringify(modelInputs[1])
    const thirdInput = JSON.stringify(modelInputs[2])
    const fourthInput = JSON.stringify(modelInputs[3])
    expect(secondInput).toContain('<tool_call_repair>')
    expect(secondInput).toContain('toolu_schema_retry_1')
    expect(thirdInput).toContain('<tool_call_repair>')
    expect(thirdInput).toContain('toolu_schema_retry_2')
    expect(fourthInput.match(/<tool_call_repair>/g)?.length ?? 0).toBe(2)
    expect(fourthInput).not.toContain('toolUseId: toolu_schema_retry_3')
    expect(fourthInput).toContain('toolu_schema_retry_3')
  })

  test('completion verification failure is fed back into a second model pass', async () => {
    await writeTempFile(
      tempDir,
      'package.json',
      JSON.stringify({
        type: 'module',
        scripts: {
          verify:
            'echo "src/failing.test.ts(7,3): error TS2304: Cannot find name nope." >&2; exit 1',
        },
      }),
    )

    const toolUseContext = createToolUseContext({
      isNonInteractiveSession: false,
      settings: {
        verificationRunner: {
          commands: ['bun run verify'],
          timeoutMs: 5_000,
          runOnCompletion: true,
        },
      },
    })

    const modelInputs: unknown[] = []
    let callCount = 0
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        modelInputs.push(messages)
        yield createTextAssistantMessage(
          callCount === 1
            ? 'I changed the file.'
            : 'I fixed it after verification.',
        )
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'make a change',
        }),
        createAttachmentMessage({
          type: 'edited_text_file',
          filename: `${tempDir}/src/failing.test.ts`,
          snippet: '1  const nope = missing',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'repl_main_thread',
      maxTurns: 3,
      deps: deps as never,
    })

    const emitted: any[] = []
    let next = await generator.next()
    while (!next.done) {
      emitted.push(next.value)
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(modelInputs[1])).toContain('<verification_result>')
    expect(JSON.stringify(modelInputs[1])).toContain('verification failed')
    expect(toolUseContext.getAppState().verificationStatus).toMatchObject({
      status: 'failed',
      total: 1,
      passed: 0,
      failed: 1,
    })
    expect(
      emitted.some(
        message =>
          message.type === 'system' &&
          message.content.includes('Verification failed: 0/1 commands passed'),
      ),
    ).toBe(true)
  })

  test('context packer injects an explicit settings-enabled pack before the model call', async () => {
    await writeTempFile(
      tempDir,
      'package.json',
      JSON.stringify({
        type: 'module',
        scripts: {
          typecheck: 'bunx tsc --noEmit',
          test: 'bun test',
        },
      }),
    )

    const toolUseContext = createToolUseContext({
      settings: {
        contextPacker: {
          enabled: true,
          maxChars: 4_000,
        },
      },
    })
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('packed context received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'wire ContextPacker into query',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    const serializedInput = JSON.stringify(modelInputs[0])
    expect(next.value.reason).toBe('completed')
    expect(serializedInput).toContain('<context_pack>')
    expect(serializedInput).toContain('wire ContextPacker into query')
    expect(serializedInput).toContain('package_scripts')
    expect(serializedInput).toContain('typecheck: bunx tsc --noEmit')
  })

  test('context packer does not inject when explicitly disabled', async () => {
    await writeTempFile(
      tempDir,
      'package.json',
      JSON.stringify({
        type: 'module',
        scripts: {
          typecheck: 'bunx tsc --noEmit',
        },
      }),
    )

    const toolUseContext = createToolUseContext({
      settings: {
        contextPacker: {
          enabled: false,
          maxChars: 4_000,
        },
      },
    })
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('plain context received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'do not pack this request',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(JSON.stringify(modelInputs[0])).not.toContain('<context_pack>')
  })

  test('context packer skips ordinary short tasks without an automatic trigger', async () => {
    await writeTempFile(
      tempDir,
      'package.json',
      JSON.stringify({
        type: 'module',
        scripts: {
          typecheck: 'bunx tsc --noEmit',
        },
      }),
    )

    const toolUseContext = createToolUseContext()
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('plain context received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'say hi',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(JSON.stringify(modelInputs[0])).not.toContain('<context_pack>')
    expect(toolUseContext.options.contextWatermark).toBeUndefined()
  })

  test('context packer auto-injects for DeepSeek V4 Pro high effort', async () => {
    await writeTempFile(
      tempDir,
      'package.json',
      JSON.stringify({
        type: 'module',
        scripts: {
          typecheck: 'bunx tsc --noEmit',
        },
      }),
    )

    const toolUseContext = createToolUseContext({
      mainLoopModel: 'deepseek-v4-pro',
      effortValue: 'high',
    })
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('packed context received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'fix the DeepSeek context pack routing',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    const serializedInput = JSON.stringify(modelInputs[0])
    expect(next.value.reason).toBe('completed')
    expect(serializedInput).toContain('<context_pack>')
    expect(serializedInput).toContain('fix the DeepSeek context pack routing')
    expect(toolUseContext.options.contextWatermark).toMatchObject({
      source: 'deepseek-v4-pro:high',
      triggerReason: 'deepseek-v4-pro-high',
    })
  })

  test('context packer carries recent verification metadata into automatic packs', async () => {
    const toolUseContext = createToolUseContext({
      mainLoopModel: 'deepseek-v4-pro',
      effortValue: 'max',
    })
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('verification context received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'fix the failure',
        }),
        createUserMessage({
          content:
            '<verification_result>\nstatus: failed\nissues:\n- Typecheck: src/index.ts(1,1): error TS2304\n</verification_result>',
          isMeta: true,
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    const serializedInput = JSON.stringify(modelInputs[0])
    expect(next.value.reason).toBe('completed')
    expect(serializedInput).toContain('<context_pack>')
    expect(serializedInput).toContain('<verification_result>')
    expect(serializedInput).toContain('status: failed')
  })

  test('injects a configured Agentic Search evidence pack before the model call', async () => {
    const toolUseContext = createToolUseContext({
      settings: {
        agenticSearch: {
          enabled: true,
          mode: 'injected-pack',
          maxEvidenceChars: 400,
          evidencePack: {
            text: [
              '<agentic_search_evidence>',
              '- [A1.1] type=primary source=https://docs.example.test :: Primary docs support the claim.',
              '- [A2.1] type=independent source=https://news.example.test :: Independent source confirms it.',
              '</agentic_search_evidence>',
            ].join('\n'),
            metadata: {
              citationCount: 2,
              crossCheckCoverage: 1,
            },
          },
        },
      },
    })
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('agentic evidence received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'verify this claim with citations',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    const serializedInput = JSON.stringify(modelInputs[0])
    expect(next.value.reason).toBe('completed')
    expect(serializedInput).toContain('<agentic_search_evidence>')
    expect(serializedInput).toContain('type=primary')
    expect(serializedInput).toContain('type=independent')
  })

  test('runs live Agentic Search and injects the returned evidence pack before the model call', async () => {
    const toolUseContext = createToolUseContext({
      settings: {
        agenticSearch: {
          enabled: true,
          mode: 'live',
          effort: 'balanced',
          maxEvidenceChars: 500,
        },
      },
    })
    const modelInputs: unknown[] = []
    const liveRequests: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      agenticSearchLive: async (input: unknown) => {
        liveRequests.push(input)
        return {
          integration: {
            target: 'query_loop',
            text: [
              '<agentic_search_evidence>',
              '- [A1.1] type=primary source=https://docs.example.test :: Live primary docs support the claim.',
              '- [A2.1] type=independent source=https://independent.example.test :: Live independent source confirms it.',
              '</agentic_search_evidence>',
            ].join('\n'),
            metadata: {
              planId: 'agentic-search-live-test',
              effort: 'balanced',
              task: 'verify latest API docs with citations',
              packChars: 220,
              budgetChars: 500,
              citationCount: 2,
              truncatedClaimCount: 0,
              primaryClaimCount: 1,
              independentClaimCount: 1,
              conflictCount: 0,
              crossCheckCoverage: 1,
              estimatedInputTokens: 55,
              estimatedCostUsd: 0.000011,
              citationCompressionRatio: 1,
              recommendedInjectionTarget: 'query_loop',
            },
            citations: [],
          },
          metrics: {
            rounds: 2,
            maxFetchConcurrency: 2,
            searchCount: 2,
            fetchCount: 2,
            sourceEvidenceCount: 1,
            failedSearchCount: 0,
            failedFetchCount: 0,
            failedSourceCount: 0,
            privateUrlSkippedCount: 1,
            uniqueUrlCount: 2,
            evidenceChars: 300,
            evidenceClaimCount: 2,
            primaryClaimCount: 1,
            independentClaimCount: 1,
            conflictCount: 0,
            crossCheckCoverage: 1,
            citationCount: 2,
            citationCompressionRatio: 1,
            estimatedInputTokens: 55,
            estimatedCostUsd: 0.000011,
            comparisonMode: 'agentic_search',
            durationMs: 12,
          },
          result: {},
        }
      },
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('live agentic evidence received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'verify latest API docs with citations',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    const serializedInput = JSON.stringify(modelInputs[0])
    expect(next.value.reason).toBe('completed')
    expect(liveRequests).toHaveLength(1)
    expect(serializedInput).toContain('<agentic_search_evidence>')
    expect(serializedInput).toContain('Live primary docs')
    expect(serializedInput).toContain('type=independent')
  })

  test('working memory injects checkpoint context before the model call', async () => {
    const toolUseContext = createToolUseContext({
      settings: {
        workingMemory: {
          enabled: true,
          maxChars: 4_000,
          includeInPrompt: true,
        },
      },
      workingMemory: createWorkingMemory(
        {
          goal: 'Preserve compact checkpoint in query',
          verificationStatus: {
            status: 'failed',
            summary: 'typecheck failed',
          },
          nextSteps: ['Fix the failing typecheck before final response'],
        },
        123,
      ),
    })
    const modelInputs: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        modelInputs.push(messages)
        yield createTextAssistantMessage('working memory received.')
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: 'continue after compact',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 1,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    const serializedInput = JSON.stringify(modelInputs[0])
    expect(next.value.reason).toBe('completed')
    expect(serializedInput).toContain('<working_memory>')
    expect(serializedInput).toContain('Preserve compact checkpoint in query')
    expect(serializedInput).toContain('typecheck failed')
  })

  test('provider api-error messages fail a consumed autonomy run instead of advancing the flow', async () => {
    const previousDisableAttachments =
      process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
    process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = '1'
    try {
      const command = await startManagedAutonomyFlowFromHeartbeatTask({
        task: {
          name: 'provider-boundary',
          interval: '1h',
          prompt: 'Exercise provider boundary',
          steps: [
            { name: 'first', prompt: 'First provider-boundary step' },
            { name: 'second', prompt: 'Second provider-boundary step' },
          ],
        },
        rootDir: tempDir,
        currentDir: tempDir,
        priority: 'next',
      })
      expect(command).not.toBeNull()
      enqueue(command!)

      const toolUseContext = createToolUseContext()

      let callCount = 0
      const deps = {
        uuid: () => 'query-chain-id',
        microcompact: async (messages: unknown[]) => ({ messages }),
        autocompact: async () => ({
          compactionResult: undefined,
          consecutiveFailures: 0,
        }),
        callModel: async function* () {
          callCount += 1
          if (callCount === 1) {
            yield createToolUseAssistantMessage()
            return
          }
          yield createAssistantAPIErrorMessage({
            content: 'API Error: provider unavailable',
            apiError: 'api_error',
            error: new Error('provider unavailable') as never,
          })
        },
      }

      const emitted: any[] = []
      const generator = query({
        messages: [
          createUserMessage({
            content: 'start provider-boundary test',
          }),
        ],
        systemPrompt: asSystemPrompt([]),
        userContext: {},
        systemContext: {},
        canUseTool: async (_tool, input) => ({
          behavior: 'allow',
          updatedInput: input,
        }),
        toolUseContext,
        querySource: 'sdk',
        maxTurns: 3,
        deps: deps as never,
      })
      let next = await generator.next()
      while (!next.done) {
        emitted.push(next.value)
        next = await generator.next()
      }

      const [flow] = await listAutonomyFlows(tempDir)
      const finalFlow = await getAutonomyFlowById(flow!.flowId, tempDir)
      const run = await getAutonomyRunById(command!.autonomy!.runId, tempDir)

      expect(next.value.reason).toBe('model_error')
      expect(callCount).toBe(2)
      expect(
        emitted.some(
          message =>
            message.type === 'attachment' &&
            message.attachment.type === 'queued_command',
        ),
      ).toBe(true)
      expect(run!.status).toBe('failed')
      expect(run!.error).toBe('provider api_error')
      expect(finalFlow!.status).toBe('failed')
      expect(finalFlow!.stateJson!.steps.map(step => step.status)).toEqual([
        'failed',
        'pending',
      ])
      expect(getCommandsByMaxPriority('later')).toHaveLength(0)
    } finally {
      if (previousDisableAttachments === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
      } else {
        process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = previousDisableAttachments
      }
    }
  })

  test('generator return cancels a consumed autonomy run instead of leaving it running', async () => {
    const previousDisableAttachments =
      process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
    process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = '1'
    try {
      const command = await startManagedAutonomyFlowFromHeartbeatTask({
        task: {
          name: 'return-boundary',
          interval: '1h',
          prompt: 'Exercise generator return boundary',
          steps: [
            { name: 'first', prompt: 'First return-boundary step' },
            { name: 'second', prompt: 'Second return-boundary step' },
          ],
        },
        rootDir: tempDir,
        currentDir: tempDir,
        priority: 'next',
      })
      expect(command).not.toBeNull()
      enqueue(command!)

      const toolUseContext = createToolUseContext()
      const deps = {
        uuid: () => 'query-chain-id',
        microcompact: async (messages: unknown[]) => ({ messages }),
        autocompact: async () => ({
          compactionResult: undefined,
          consecutiveFailures: 0,
        }),
        callModel: async function* () {
          yield createToolUseAssistantMessage()
        },
      }

      const generator = query({
        messages: [
          createUserMessage({
            content: 'start return-boundary test',
          }),
        ],
        systemPrompt: asSystemPrompt([]),
        userContext: {},
        systemContext: {},
        canUseTool: async (_tool, input) => ({
          behavior: 'allow',
          updatedInput: input,
        }),
        toolUseContext,
        querySource: 'sdk',
        maxTurns: 3,
        deps: deps as never,
      })

      let sawQueuedAttachment = false
      let next = await generator.next()
      while (!next.done) {
        const message = next.value as any
        if (
          message.type === 'attachment' &&
          message.attachment.type === 'queued_command'
        ) {
          sawQueuedAttachment = true
          await generator.return(undefined as never)
          break
        }
        next = await generator.next()
      }

      const [flow] = await listAutonomyFlows(tempDir)
      const finalFlow = await getAutonomyFlowById(flow!.flowId, tempDir)
      const run = await getAutonomyRunById(command!.autonomy!.runId, tempDir)

      expect(sawQueuedAttachment).toBe(true)
      expect(run!.status).toBe('cancelled')
      expect(finalFlow!.status).toBe('cancelled')
      expect(finalFlow!.stateJson!.steps.map(step => step.status)).toEqual([
        'cancelled',
        'cancelled',
      ])
      expect(getCommandsByMaxPriority('later')).toHaveLength(0)
    } finally {
      if (previousDisableAttachments === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
      } else {
        process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = previousDisableAttachments
      }
    }
  })
})
