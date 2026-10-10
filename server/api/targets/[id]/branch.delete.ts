// Abandon d'une correction : seules les branches du scanner se suppriment d'ici
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef(String(getQuery(event).ref ?? ''))
  if (!ref.startsWith('security/')) {
    throw createError({ statusCode: 403, message: 'Seules les branches security/* se suppriment d’ici' })
  }
  const pr = await pullForBranch(t, ref)
  if (pr) {
    await githubApi(`/repos/${t.repo}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } })
  }
  await githubApi(`/repos/${t.repo}/git/refs/heads/${ref}`, { method: 'DELETE' })
  return { ok: true }
})
