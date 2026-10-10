export default defineEventHandler(() => {
  return useDb().prepare(`
    SELECT s.id, s.origin, s.status, s.created_at, s.finished_at, t.name AS target,
      SUM(f.severity = 'critical') AS critical, SUM(f.severity = 'high') AS high,
      SUM(f.severity = 'medium') AS medium, SUM(f.severity = 'low') AS low,
      COUNT(f.id) AS total
    FROM scans s
    JOIN targets t ON t.id = s.target_id
    LEFT JOIN findings f ON f.scan_id = s.id
    GROUP BY s.id ORDER BY s.id DESC LIMIT 50
  `).all()
})
