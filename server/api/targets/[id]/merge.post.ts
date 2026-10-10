import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200) })

// Merge en squash, seulement si tout est vert. Les mêmes conditions que l'écran, revérifiées ici
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef((await readValidatedBody(event, Body.parse)).ref)
  const pr = await pullForBranch(t, ref)
  if (!pr) throw createError({ statusCode: 409, message: 'Pas de pull request ouverte : valider d’abord' })
  if (pr.draft) throw createError({ statusCode: 409, message: 'Pull request en brouillon' })

  const branchScan = latestScan(t.id, ref)
  if (!branchScan || branchScan.sha !== pr.head.sha) {
    throw createError({ statusCode: 409, message: 'Le dernier commit de la branche n’a pas été scanné' })
  }
  const checks = await checksFor(t.repo, pr.head.sha)
  if (checks.state === 'failure' || checks.state === 'pending') {
    throw createError({ statusCode: 409, message: `Checks ${checks.state === 'pending' ? 'en cours' : 'en échec'}` })
  }

  // sha : GitHub refuse le merge si un commit est arrivé entre-temps
  await githubApi(`/repos/${t.repo}/pulls/${pr.number}/merge`, {
    method: 'PUT',
    body: { merge_method: 'squash', sha: pr.head.sha },
  })
  // La branche part, sauf si elle est protégée
  await githubApi(`/repos/${t.repo}/git/refs/heads/${ref}`, { method: 'DELETE' }).catch(() => {})
  // La prod a changé : nouveau scan de la branche par défaut
  const { scanId } = enqueueScan(t.id, 'manuel')
  return { merged: true, scanId }
})
