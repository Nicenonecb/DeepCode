import { describe, expect, test } from 'bun:test'
import {
  attachWorkingMemoryCheckpoint,
  createWorkingMemory,
  getLatestWorkingMemoryCheckpoint,
} from '../../workingMemory/index.js'
import { createCompactBoundaryMessage } from '../../../utils/messages.js'
import { buildPostCompactMessages } from '../compact.js'

describe('compact working memory checkpoint', () => {
  test('keeps WorkingMemory checkpoint on the post-compact boundary', () => {
    const memory = createWorkingMemory(
      {
        goal: 'Finish compact persistence',
        nextSteps: ['Run compact integration tests'],
      },
      100,
    )
    const boundaryMarker = attachWorkingMemoryCheckpoint(
      createCompactBoundaryMessage('auto', 123),
      memory,
      {
        enabled: true,
        maxChars: 1_000,
      },
    )

    const messages = buildPostCompactMessages({
      boundaryMarker,
      summaryMessages: [],
      attachments: [],
      hookResults: [],
    })

    expect(messages[0]).toBe(boundaryMarker)
    expect(
      getLatestWorkingMemoryCheckpoint(messages, {
        enabled: true,
        maxChars: 1_000,
      })?.goal,
    ).toBe('Finish compact persistence')
  })
})
