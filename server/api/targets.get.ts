// Credentials never leave the database, only whether they exist.
// done_*: latest finished scan of the default branch, with its counts
export default defineEventHandler(() => {
  return useDb().prepare(`
    SELECT t.id, t.name, t.repo, t.url, t.scheduled, t.provider, t.auth_header IS NOT NULL AS has_auth,
      (SELECT s.id FROM scans s WHERE s.target_id = t.id ORDER BY s.id DESC LIMIT 1) AS last_scan_id,
      d.id AS done_scan_id, d.created_at AS done_at,
      SUM(f.severity = 'critical') AS critical, SUM(f.severity = 'high') AS high,
      SUM(f.severity = 'medium') AS medium, SUM(f.severity = 'low') AS low,
      COUNT(f.id) AS total
    FROM targets t
    LEFT JOIN scans d ON d.id = (
      SELECT MAX(s.id) FROM scans s WHERE s.target_id = t.id AND s.status = 'done' AND s.ref IS NULL
    )
    LEFT JOIN findings f ON f.scan_id = d.id
    GROUP BY t.id ORDER BY t.name
  `).all()
})
