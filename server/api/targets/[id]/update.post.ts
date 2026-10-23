import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200) })

// Branche en retard sur la base : on y merge la base, puis on la rescanne.
// En conflit, une branche du scanner se recrée depuis la base actuelle, l'ancienne part
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef((await readValidatedBody(event, Body.parse)).ref)
  const base = await defaultBranch(t.repo)
  if (ref === base) throw createError({ statusCode: 400, message: 'La branche par défaut est déjà à jour' })

  const update = await updateBranch(t.repo, ref, base)
  if (!update.conflict) {
    const { scanId } = enqueueScan(t.id, 'manuel', null, ref)
    return { updated: true, scanId }
  }

  if (!ref.startsWith('security/')) {
    throw createError({ statusCode: 409, message: `Conflits avec ${base} : à résoudre dans le dépôt, puis rescanner` })
  }
  const baseScan = latestScan(t.id, null)
  if (!baseScan) throw createError({ statusCode: 409, message: `Conflits avec ${base}, et aucun scan de ${base} pour recréer la correction` })
  const fixId = enqueueFix(baseScan.id)
  const pr = await pullForBranch(t, ref)
  if (pr) await githubApi(`/repos/${t.repo}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } })
  await githubApi(`/repos/${t.repo}/git/refs/heads/${ref}`, { method: 'DELETE' })
  return { recreated: true, fixId, baseScanId: baseScan.id }
})
