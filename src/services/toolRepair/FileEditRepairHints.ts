export function createFileEditValidationRepairHint(
  message: string,
): string | undefined {
  if (message.includes('String to replace not found in file')) {
    return [
      'Do not retry the same old_string.',
      'Read the current file contents again, then choose a smaller unique old_string that exactly exists in the file.',
      'For long shader/template-literal edits or repeated failures, stop using piecemeal Update calls and rewrite the enclosing function/block from the freshly read content.',
    ].join(' ')
  }

  if (message.includes('File has been modified since read')) {
    return [
      'Do not retry this edit against stale content.',
      'Read the file again first, inspect the current diff/state, then issue a new edit based on the freshly read file.',
    ].join(' ')
  }

  if (
    /Found \d+ matches of the string to replace, but replace_all is false/.test(
      message,
    )
  ) {
    return [
      'Do not retry with the same ambiguous old_string.',
      'Add surrounding context so the old_string uniquely identifies one occurrence, or set replace_all only when every occurrence should change.',
    ].join(' ')
  }

  return undefined
}
