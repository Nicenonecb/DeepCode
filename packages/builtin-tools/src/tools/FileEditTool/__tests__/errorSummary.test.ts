import { describe, expect, test } from 'bun:test'
import { summarizeFileEditError } from '../errorSummary'

describe('summarizeFileEditError', () => {
  test('explains modified-after-read errors', () => {
    expect(
      summarizeFileEditError(
        'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
      ),
    ).toBe('File changed after it was read. Read it again before editing.')
  })

  test('shows the missing replacement string', () => {
    expect(
      summarizeFileEditError(
        'String to replace not found in file.\nString: \tconst timelineJumpRef = useRef<number | null>(null);',
      ),
    ).toBe(
      'String to replace not found: const timelineJumpRef = useRef<number | null>(null);',
    )
  })

  test('explains ambiguous replacement matches', () => {
    expect(
      summarizeFileEditError(
        'Found 3 matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true.',
      ),
    ).toBe('Found 3 matches. Add context or set replace_all.')
  })
})
