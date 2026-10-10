export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()
  const scan = db.prepare(`
    SELECT s.status, s.ref, t.repo FROM scans s JOIN targets t ON t.id = s.target_id WHERE s.id = ?
  `).get(id) as { status: string, ref: string | null, repo: string | null } | undefined
  if (!scan) throw createError({ statusCode: 404, message: 'Scan inconnu' })
  if (scan.status !== 'done') throw createError({ statusCode: 409, message: 'Le scan doit être terminé' })
  if (scan.ref) throw createError({ statusCode: 400, message: 'On corrige depuis un scan de la branche par défaut' })
  if (!scan.repo) throw createError({ statusCode: 400, message: 'Pas de dépôt : rien à corriger' })
  if (!useRuntimeConfig().githubToken) {
    throw createError({ statusCode: 400, message: 'NUXT_GITHUB_TOKEN requis, avec Contents et Pull requests en écriture' })
  }
  const busy = db.prepare(`SELECT id FROM fixes WHERE scan_id = ? AND status IN ('queued', 'running')`).get(id)
  if (busy) throw createError({ statusCode: 409, message: 'Une correction est déjà en cours' })
  return { fixId: enqueueFix(id) }
})
