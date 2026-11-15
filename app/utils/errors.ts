// The message of the server when it sent one, never a bare "Error"
export function errorMessage(err: unknown, fallback = 'The request failed. Check the server logs.') {
  const e = err as { data?: { message?: string }, statusMessage?: string } | null | undefined
  return e?.data?.message || e?.statusMessage || fallback
}
