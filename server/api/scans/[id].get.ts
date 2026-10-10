export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()
  const scan = db.prepare(`
    SELECT s.*, t.name AS target, t.repo, t.url
    FROM scans s JOIN targets t ON t.id = s.target_id WHERE s.id = ?
  `).get(id)
  if (!scan) throw createError({ statusCode: 404, message: 'Scan inconnu' })
  const findings = db.prepare(`
    SELECT * FROM findings WHERE scan_id = ?
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, tool
  `).all(id)
  return { scan, findings }
})
