export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()
  const scan = db.prepare(`
    SELECT s.status, s.ref, t.repo FROM scans s JOIN targets t ON t.id = s.target_id WHERE s.id = ?
  `).get(id) as { status: string, ref: string | null, repo: string | null } | undefined
  if (!scan) throw createError({ statusCode: 404, message: 'Unknown scan' })
  if (scan.status !== 'done') throw createError({ statusCode: 409, message: 'The scan must be finished' })
  if (scan.ref) throw createError({ statusCode: 400, message: 'Fixes start from a scan of the default branch' })
  if (!scan.repo) throw createError({ statusCode: 400, message: 'No repository: nothing to fix' })
  if (!useRuntimeConfig().githubToken) {
    throw createError({ statusCode: 400, message: 'NUXT_GITHUB_TOKEN is required, with Contents and Pull requests write access' })
  }
  const busy = db.prepare(`SELECT id FROM fixes WHERE scan_id = ? AND status IN ('queued', 'running')`).get(id)
  if (busy) throw createError({ statusCode: 409, message: 'A fix is already running' })
  return { fixId: enqueueFix(id) }
})
