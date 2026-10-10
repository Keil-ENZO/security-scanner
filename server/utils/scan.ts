import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

interface TargetRow {
  id: number
  name: string
  repo: string | null
  url: string | null
  auth_header: string | null
}

// Un seul scan à la fois : la file vit en mémoire
let queue: Promise<unknown> = Promise.resolve()

export function enqueueScan(targetId: number, origin: 'manuel' | 'hebdo') {
  const { lastInsertRowid } = useDb()
    .prepare('INSERT INTO scans (target_id, origin) VALUES (?, ?)')
    .run(targetId, origin)
  const scanId = Number(lastInsertRowid)
  const done = queue.then(() => runScan(scanId))
  queue = done.catch(() => {})
  return { scanId, done }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function runScan(scanId: number) {
  const db = useDb()
  const target = db.prepare(`
    SELECT t.id, t.name, t.repo, t.url, t.auth_header
    FROM scans s JOIN targets t ON t.id = s.target_id WHERE s.id = ?
  `).get(scanId) as unknown as TargetRow | undefined
  if (!target) return

  db.prepare(`UPDATE scans SET status = 'running', started_at = datetime('now') WHERE id = ?`).run(scanId)
  const work = join(useRuntimeConfig().dataDir, 'work', String(scanId))
  mkdirSync(work, { recursive: true, mode: 0o700 })
  const findings: Finding[] = []
  const errors: string[] = []

  // Un outil en échec n'arrête pas les autres
  const step = async (name: string, fn: () => Promise<Finding[]>) => {
    try {
      findings.push(...await fn())
    }
    catch (err) {
      errors.push(`${name} : ${message(err)}`)
    }
  }

  try {
    // L'allowlist est revérifiée à chaque scan, pas seulement à l'ajout
    if (target.repo) {
      const repo = parseRepo(`https://github.com/${target.repo}`)
      const src = join(work, 'src')
      await step('git', async () => {
        await cloneRepo(repo, src)
        return []
      })
      if (!errors.length) {
        await step('trivy', () => trivy(src))
        await step('semgrep', () => semgrep(src))
      }
    }
    if (target.url) {
      const url = parseSite(target.url)
      const auth = target.auth_header ? decrypt(target.auth_header) : null
      await step('nuclei', () => nuclei(url, auth, work))
    }

    const insert = db.prepare(`
      INSERT INTO findings (scan_id, tool, severity, title, rule_id, cve, cwe, cvss, location, description, remediation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.exec('BEGIN')
    for (const f of findings) {
      insert.run(scanId, f.tool, f.severity, f.title, f.ruleId ?? null, f.cve ?? null, f.cwe ?? null,
        f.cvss ?? null, f.location ?? null, f.description ?? null, f.remediation ?? null)
    }
    db.exec('COMMIT')

    let summary: string | null = null
    try {
      summary = await writeSummary(target.name, findings)
    }
    catch (err) {
      errors.push(`rapport : ${message(err)}`)
    }

    db.prepare(`
      UPDATE scans SET status = 'done', summary = ?, error = ?, finished_at = datetime('now') WHERE id = ?
    `).run(summary, errors.join('\n') || null, scanId)

    const head = `🛡️ ${target.name} : ${formatCounts(countBySeverity(findings))}`
    const tail = errors.length ? `\n\n⚠️ ${errors.join('\n')}` : ''
    await notify(`${head}\n\n${summary ?? 'Rapport indisponible.'}${tail}`).catch(() => {})
  }
  catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.prepare(`
      UPDATE scans SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?
    `).run([...errors, message(err)].join('\n'), scanId)
  }
  finally {
    rmSync(work, { recursive: true, force: true })
  }
}
