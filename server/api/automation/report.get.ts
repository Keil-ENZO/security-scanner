// Batch summary as plain text, ready to post to a chat as is.
// 202 while a scan of the batch is running. With ?notify=1, also sent to the configured channels
interface Row { id: number, name: string, status: string, error: string | null, summary: string | null }

export default defineEventHandler(async (event) => {
  const batch = String(getQuery(event).batch ?? '')
  if (!/^[0-9a-f-]{36}$/.test(batch)) throw createError({ statusCode: 400, message: 'Invalid batch' })
  const db = useDb()
  const scans = db.prepare(`
    SELECT s.id, t.name, s.status, s.error, s.summary FROM scans s JOIN targets t ON t.id = s.target_id
    WHERE s.batch = ? ORDER BY t.name
  `).all(batch) as unknown as Row[]
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  if (!scans.length) return '🛡️ Scheduled audit: no target is marked as scheduled.'
  if (scans.some(s => s.status === 'queued' || s.status === 'running')) {
    setResponseStatus(event, 202)
    return 'running'
  }

  const { publicUrl } = useRuntimeConfig()
  const top = db.prepare(`
    SELECT title FROM findings WHERE scan_id = ? AND severity IN ('critical', 'high')
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END LIMIT 3
  `)
  const lines = ['🛡️ Scheduled audit', '']
  for (const s of scans) {
    const findings = db.prepare('SELECT severity FROM findings WHERE scan_id = ?').all(s.id) as { severity: string }[]
    lines.push(`${s.name}: ${s.status === 'failed' ? 'failed' : formatCounts(countBySeverity(findings))}`)
    const verdict = verdictOf(s.summary)
    if (verdict) lines.push(`  ${verdict.slice(0, 200)}`)
    for (const f of top.all(s.id) as { title: string }[]) lines.push(`  • ${f.title.slice(0, 120)}`)
    if (s.error) lines.push(`  ⚠️ ${s.error.split('\n')[0]!.slice(0, 160)}`)
    lines.push(`  ${publicUrl}/scans/${s.id}`, '')
  }
  const text = lines.join('\n').trim()
  if (getQuery(event).notify === '1') await notify(text)
  return text
})
