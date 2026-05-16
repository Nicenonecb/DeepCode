const MAX_SNIPPET_LENGTH = 160

function compactSnippet(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  if (compacted.length <= MAX_SNIPPET_LENGTH) {
    return compacted
  }
  return `${compacted.slice(0, MAX_SNIPPET_LENGTH - 1)}...`
}

export function summarizeFileEditError(
  errorMessage: string | null | undefined,
): string {
  if (!errorMessage) {
    return 'Error editing file'
  }

  if (errorMessage.includes('File has been modified since read')) {
    return 'File changed after it was read. Read it again before editing.'
  }

  const missingString = errorMessage.match(
    /String to replace not found in file\.\nString: ([\s\S]*)/,
  )
  if (missingString?.[1]) {
    return `String to replace not found: ${compactSnippet(missingString[1])}`
  }

  const multipleMatches = errorMessage.match(
    /Found (\d+) matches of the string to replace, but replace_all is false/,
  )
  if (multipleMatches?.[1]) {
    return `Found ${multipleMatches[1]} matches. Add context or set replace_all.`
  }

  return compactSnippet(errorMessage.split('\n')[0] ?? errorMessage)
}
