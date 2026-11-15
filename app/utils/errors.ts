// The message of the server when it sent one, never a bare "Error"
export function errorMessage(err: unknown, fallback = 'The request failed. Check the server logs.') {
  const e = err as { data?: { message?: string }, statusMessage?: string } | null | undefined
  return validationMessage(e?.data?.message) || e?.data?.message || e?.statusMessage || fallback
}

// A body refused by its schema comes back as the JSON list of issues: keep the first one, with its field
function validationMessage(message: string | undefined) {
  if (!message?.startsWith('[')) return null
  try {
    const issue = (JSON.parse(message) as { message?: string, path?: (string | number)[] }[])[0]
    if (!issue?.message) return null
    return issue.path?.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message
  }
  catch {
    return null
  }
}
