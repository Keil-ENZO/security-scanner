import { z } from 'zod'

const Query = z.object({ limit: z.coerce.number().int().min(1).default(10) })

// History by entry: a scheduled batch counts as one, see groupHistory.
// One entry more than asked tells whether older ones exist
export default defineEventHandler(async (event) => {
  const { limit } = await getValidatedQuery(event, q => Query.parse(q))
  const db = useDb()
  const rows = db.prepare(`
    WITH page AS (
      SELECT COALESCE(batch, id) AS entry FROM scans GROUP BY entry ORDER BY MAX(id) DESC LIMIT ?
    )
    SELECT s.id, s.origin, s.status, s.ref, s.batch, s.created_at, t.name AS target,
      SUM(f.severity = 'critical') AS critical, SUM(f.severity = 'high') AS high,
      SUM(f.severity = 'medium') AS medium, SUM(f.severity = 'low') AS low,
      COUNT(f.id) AS total
    FROM scans s
    JOIN page p ON p.entry = COALESCE(s.batch, s.id)
    JOIN targets t ON t.id = s.target_id
    LEFT JOIN findings f ON f.scan_id = s.id
    GROUP BY s.id ORDER BY s.id DESC
  `).all(limit + 1) as unknown as HistoryScan[]
  // The tiles cover every scan, not only the entries on the page
  const stats = db.prepare(`
    SELECT COALESCE(SUM(status IN ('queued', 'running')), 0) AS active,
      MAX(CASE WHEN status = 'done' THEN created_at END) AS last_done,
      MAX(CASE WHEN origin = 'scheduled' THEN created_at END) AS last_scheduled
    FROM scans
  `).get() as unknown as { active: number, last_done: string | null, last_scheduled: string | null }
  return { ...groupHistory(rows, limit), ...stats }
})
