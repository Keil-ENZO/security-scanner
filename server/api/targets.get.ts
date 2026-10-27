// Credentials never leave the database, only whether they exist
export default defineEventHandler(() => {
  return useDb().prepare(`
    SELECT t.id, t.name, t.repo, t.url, t.scheduled, t.auth_header IS NOT NULL AS has_auth,
      (SELECT s.id FROM scans s WHERE s.target_id = t.id ORDER BY s.id DESC LIMIT 1) AS last_scan_id
    FROM targets t ORDER BY t.name
  `).all()
})
