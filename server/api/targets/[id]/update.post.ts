import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200) })

// Branch behind the base: merge the base into it, then scan it again.
// On conflict, a scanner branch is recreated from the current base and the old one goes away
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef((await readValidatedBody(event, Body.parse)).ref)
  const base = await defaultBranch(t.repo)
  if (ref === base) throw createError({ statusCode: 400, message: 'The default branch is already up to date' })

  const update = await updateBranch(t.repo, ref, base)
  if (!update.conflict) {
    const { scanId } = enqueueScan(t.id, 'manual', null, ref)
    return { updated: true, scanId }
  }

  if (!ref.startsWith('security/')) {
    throw createError({ statusCode: 409, message: `Conflicts with ${base}: resolve them in the repository, then scan again` })
  }
  const baseScan = latestScan(t.id, null)
  if (!baseScan) throw createError({ statusCode: 409, message: `Conflicts with ${base}, and no scan of ${base} to recreate the fix from` })
  const fixId = enqueueFix(baseScan.id)
  const pr = await pullForBranch(t, ref)
  if (pr) await githubApi(`/repos/${t.repo}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } })
  await githubApi(`/repos/${t.repo}/git/refs/heads/${ref}`, { method: 'DELETE' })
  return { recreated: true, fixId, baseScanId: baseScan.id }
})
