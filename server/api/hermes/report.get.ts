// Résumé d'un lot, en texte brut : Hermes le publie tel quel sur Telegram.
// 202 tant qu'un scan du lot tourne
interface Row { id: number, name: string, status: string, error: string | null, summary: string | null }

export default defineEventHandler((event) => {
  const batch = String(getQuery(event).batch ?? '')
  if (!/^[0-9a-f-]{36}$/.test(batch)) throw createError({ statusCode: 400, message: 'Lot invalide' })
  const db = useDb()
  const scans = db.prepare(`
    SELECT s.id, t.name, s.status, s.error, s.summary FROM scans s JOIN targets t ON t.id = s.target_id
    WHERE s.batch = ? ORDER BY t.name
  `).all(batch) as unknown as Row[]
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  if (!scans.length) return '🛡️ Audit du jeudi : aucune cible cochée « hebdo ».'
  if (scans.some(s => s.status === 'queued' || s.status === 'running')) {
    setResponseStatus(event, 202)
    return 'en cours'
  }

  const { publicUrl } = useRuntimeConfig()
  const top = db.prepare(`
    SELECT title FROM findings WHERE scan_id = ? AND severity IN ('critical', 'high')
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END LIMIT 3
  `)
  const lines = ['🛡️ Audit du jeudi', '']
  for (const s of scans) {
    const findings = db.prepare('SELECT severity FROM findings WHERE scan_id = ?').all(s.id) as { severity: string }[]
    lines.push(`${s.name} : ${s.status === 'failed' ? 'échec' : formatCounts(countBySeverity(findings))}`)
    const verdict = verdictOf(s.summary)
    if (verdict) lines.push(`  ${verdict.slice(0, 200)}`)
    for (const f of top.all(s.id) as { title: string }[]) lines.push(`  • ${f.title.slice(0, 120)}`)
    if (s.error) lines.push(`  ⚠️ ${s.error.split('\n')[0]!.slice(0, 160)}`)
    lines.push(`  ${publicUrl}/scans/${s.id}`, '')
  }
  return lines.join('\n').trim()
})
