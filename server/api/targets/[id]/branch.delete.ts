// Dropping a fix: only scanner branches can be deleted from here
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef(String(getQuery(event).ref ?? ''))
  if (!ref.startsWith('security/')) {
    throw createError({ statusCode: 403, message: 'Only security/* branches can be deleted from here' })
  }
  const pr = await pullForBranch(t, ref)
  if (pr) {
    await githubApi(`/repos/${t.repo}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } })
  }
  await githubApi(`/repos/${t.repo}/git/refs/heads/${ref}`, { method: 'DELETE' })
  return { ok: true }
})
