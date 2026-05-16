import { describe, expect, test } from 'bun:test'
import { createFileEditValidationRepairHint } from '../FileEditRepairHints'

describe('createFileEditValidationRepairHint', () => {
  test('prevents retrying the same missing old_string', () => {
    const hint = createFileEditValidationRepairHint(
      'String to replace not found in file.\nString: v += 0.085 / max(dot(p - c1, p - c1), 0.006);',
    )

    expect(hint).toContain('Do not retry the same old_string')
    expect(hint).toContain('Read the current file contents again')
    expect(hint).toContain('rewrite the enclosing function/block')
  })

  test('requires a fresh read after modified-since-read failures', () => {
    const hint = createFileEditValidationRepairHint(
      'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
    )

    expect(hint).toContain('stale content')
    expect(hint).toContain('Read the file again first')
  })

  test('asks for unique context on multiple matches', () => {
    const hint = createFileEditValidationRepairHint(
      'Found 3 matches of the string to replace, but replace_all is false.',
    )

    expect(hint).toContain('ambiguous old_string')
    expect(hint).toContain('uniquely identifies one occurrence')
  })
})
