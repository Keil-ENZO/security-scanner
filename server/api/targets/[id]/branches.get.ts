// Les branches du dépôt, lues sur GitHub, avec leur dernier scan et leur pull request
interface Branch { name: string, commit: { sha: string }, protected: boolean }

export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const [base, branches, pulls] = await Promise.all([
    defaultBranch(t.repo),
    githubApi<Branch[]>(`/repos/${t.repo}/branches`, { query: { per_page: 100 } }),
    openPulls(t.repo),
  ])
  const db = useDb()
  const lastScan = db.prepare(`
    SELECT s.id, s.status, s.sha, s.created_at,
      SUM(f.severity = 'critical') AS critical, SUM(f.severity = 'high') AS high,
      SUM(f.severity = 'medium') AS medium, SUM(f.severity = 'low') AS low
    FROM scans s LEFT JOIN findings f ON f.scan_id = s.id
    WHERE s.target_id = ? AND s.ref IS ? GROUP BY s.id ORDER BY s.id DESC LIMIT 1
  `)
  const list = branches.map((b) => {
    const isDefault = b.name === base
    const pr = pulls.find(p => p.head.ref === b.name)
    return {
      name: b.name,
      sha: b.commit.sha,
      isDefault,
      protected: b.protected,
      scanner: b.name.startsWith('security/'),
      pr: pr ? { number: pr.number, url: pr.html_url } : null,
      lastScan: lastScan.get(t.id, isDefault ? null : b.name) ?? null,
    }
  })
  // La branche par défaut d'abord, puis celles du scanner
  list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.scanner) - Number(a.scanner) || a.name.localeCompare(b.name))
  return { base, branches: list }
})
