import { describe, expect, test } from 'bun:test'
import {
  createAppStatePatchSearchStatusSink,
  runPatchSearchForHighRiskContext,
  shouldTriggerPatchSearchForHighRiskContext,
} from '../PatchSearchIntegration.js'
import type { PatchSearchFooterStatus, PatchSearchResult } from '../types.js'
import type { ToolCallRepairIssue } from '../../toolRepair/types.js'
import type { AppState } from '../../../state/AppStateStore.js'

describe('PatchSearchIntegration', () => {
  test('updates AppState status through the shared status sink', () => {
    const state = { patchSearchStatus: undefined } as AppState
    const sink = createAppStatePatchSearchStatusSink({
      setAppState: updater => {
        Object.assign(state, updater(state))
      },
    })

    sink(status({ phase: 'running', runningCount: 2 }))

    expect(state.patchSearchStatus).toMatchObject({
      phase: 'running',
      runningCount: 2,
    })
  })

  test('gates high-risk query and agent triggers on retryable repair issues', () => {
    expect(
      shouldTriggerPatchSearchForHighRiskContext({
        enabled: true,
        repairIssues: [repairIssue({ retryable: false })],
      }),
    ).toBe(false)
    expect(
      shouldTriggerPatchSearchForHighRiskContext({
        enabled: true,
        repairIssues: [repairIssue({ retryable: true })],
      }),
    ).toBe(true)
  })

  test('runs an injected query patch search runner and writes status updates', async () => {
    const updates: PatchSearchFooterStatus[] = []
    const result = resultFor('query-winner')
    const observedPrompts: string[] = []

    await runPatchSearchForHighRiskContext({
      source: 'query',
      prompt: 'fix tool failure',
      enabled: true,
      repairIssues: [repairIssue({ toolName: 'Bash', retryable: true })],
      toolUseContext: {
        setAppState: updater => {
          const prev = {
            patchSearchStatus: updates.at(-1),
          } as AppState
          const next = updater(prev)
          if (next.patchSearchStatus) updates.push(next.patchSearchStatus)
        },
      },
      runner: {
        run: async request => {
          observedPrompts.push(request.prompt)
          updates.push(status({ phase: 'running', requestId: request.id }))
          updates.push(
            status({
              phase: 'completed',
              requestId: request.id,
              selectedCandidateId: 'query-winner',
            }),
          )
          return result
        },
      },
    })

    expect(observedPrompts[0]).toContain('High-risk repair context')
    expect(updates.map(update => update.phase)).toEqual([
      'running',
      'completed',
    ])
  })

  test('can use the same trigger bridge for agent high-risk failures', async () => {
    let ran = false

    await runPatchSearchForHighRiskContext({
      source: 'agent',
      prompt: 'agent failed to repair tests',
      enabled: true,
      repairIssues: [repairIssue({ toolName: 'Agent', retryable: true })],
      toolUseContext: {
        setAppState: () => {},
      },
      runner: {
        run: async request => {
          ran = request.id.startsWith('patch-search-agent-')
          return resultFor('agent-winner')
        },
      },
    })

    expect(ran).toBe(true)
  })
})

function status(
  overrides: Partial<PatchSearchFooterStatus>,
): PatchSearchFooterStatus {
  return {
    phase: 'completed',
    requestId: 'patch-search-test',
    candidateCount: 2,
    runningCount: 0,
    verifyingCount: 0,
    failedCount: 0,
    updatedAt: 123,
    ...overrides,
  }
}

function repairIssue(
  overrides: Partial<ToolCallRepairIssue>,
): ToolCallRepairIssue {
  return {
    kind: 'runtime_error',
    toolUseId: 'toolu_1',
    toolName: 'Bash',
    input: {},
    message: 'command failed',
    retryable: true,
    repairHint: 'fix the command',
    ...overrides,
  }
}

function resultFor(candidateId: string): PatchSearchResult {
  return {
    requestId: 'patch-search-test',
    candidates: [],
    winner: {
      candidate: {
        id: candidateId,
        diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
        touchedFiles: [{ path: 'src/query.ts', status: 'modified' }],
      },
      score: {
        candidateId,
        verificationStatus: 'passed',
        verificationPassRate: 1,
        verificationFailureCount: 0,
        verificationTimedOutCount: 0,
        diffSize: 2,
        filesChanged: 1,
        targetFileCount: 1,
        touchedTargetFileCount: 1,
        targetCoverage: 1,
        riskFlagCount: 0,
        total: 1000,
        sortKey: [1],
      },
      reasons: ['verification_passed'],
      summary: {
        candidateId,
        verificationStatus: 'passed',
        verificationPassRate: 1,
        verificationFailureCount: 0,
        verificationTimedOutCount: 0,
        diffSize: 2,
        filesChanged: 1,
        touchedTargetFileCount: 1,
        targetCoverage: 1,
        riskFlags: [],
        total: 1000,
        reasons: ['verification_passed'],
      },
    },
    summary: {
      requestId: 'patch-search-test',
      winnerCandidateId: candidateId,
      selectionReason: 'verification_passed',
      candidates: [],
    },
  }
}
