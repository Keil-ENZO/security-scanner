import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

interface TargetRow {
  id: number
  name: string
  repo: string | null
  url: string | null
  auth_header: string | null
}

// One job at a time, scan or fix: the queue lives in memory
let queue: Promise<unknown> = Promise.resolve()

export function schedule<T>(job: () => Promise<T>) {
  const done = queue.then(job)
  queue = done.catch(() => {})
  return done
}

export function enqueueScan(targetId: number, origin: 'manual' | 'scheduled' | 'fix', batch: string | null = null, ref: string | null = null) {
  const { lastInsertRowid } = useDb()
    .prepare('INSERT INTO scans (target_id, origin, batch, ref) VALUES (?, ?, ?, ?)')
    .run(targetId, origin, batch, ref)
  const scanId = Number(lastInsertRowid)
  const done = schedule(() => runScan(scanId))
  return { scanId, done }
}

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function runScan(scanId: number) {
  const db = useDb()
  const target = db.prepare(`
    SELECT t.id, t.name, t.repo, t.url, t.auth_header, s.origin, s.ref
    FROM scans s JOIN targets t ON t.id = s.target_id WHERE s.id = ?
  `).get(scanId) as unknown as (TargetRow & { origin: string, ref: string | null }) | undefined
  if (!target) return

  db.prepare(`UPDATE scans SET status = 'running', started_at = datetime('now') WHERE id = ?`).run(scanId)
  const work = join(useRuntimeConfig().dataDir, 'work', String(scanId))
  mkdirSync(work, { recursive: true, mode: 0o700 })
  const findings: Finding[] = []
  const errors: string[] = []
  let sbom: Awaited<ReturnType<typeof syft>> | null = null

  // A failing tool does not stop the others
  const step = async (name: string, fn: () => Promise<Finding[]>) => {
    try {
      findings.push(...await fn())
    }
    catch (err) {
      errors.push(`${name}: ${message(err)}`)
    }
  }

  try {
    // The allowlist is checked on every scan, not only when the target is added
    if (target.repo) {
      const repo = parseRepo(`https://github.com/${target.repo}`)
      const src = join(work, 'src')
      await step('git', async () => {
        await cloneRepo(repo, src, target.ref)
        db.prepare('UPDATE scans SET sha = ? WHERE id = ?').run(await git(src, ['rev-parse', 'HEAD']), scanId)
        return []
      })
      if (!errors.length) {
        await step('trivy', () => trivy(src))
        // Grype reads the SBOM: no SBOM, no Grype
        sbom = await syft(src, work).catch((err) => {
          errors.push(`syft: ${message(err)}`)
          return null
        })
        const file = sbom?.file
        if (file) await step('grype', () => grype(file))
        await step('semgrep', () => semgrep(src))
      }
    }
    // The live site is production: a branch is only tested through its code
    if (target.url && !target.ref) {
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
    if (sbom) {
      db.prepare('INSERT INTO sboms (scan_id, format, components, content) VALUES (?, ?, ?, ?)')
        .run(scanId, 'cyclonedx-json', sbom.components, sbom.content)
    }
    db.exec('COMMIT')

    let summary: string | null = null
    try {
      summary = await writeSummary(target.name, findings)
    }
    catch (err) {
      errors.push(`report: ${message(err)}`)
    }

    db.prepare(`
      UPDATE scans SET status = 'done', summary = ?, error = ?, finished_at = datetime('now') WHERE id = ?
    `).run(summary, errors.join('\n') || null, scanId)

    // A scheduled batch gets one summary for the whole batch, sent by the caller
    if (target.origin === 'manual') {
      const lines = [
        `🛡️ ${target.name}: ${formatCounts(countBySeverity(findings))}`,
        '',
        summary ?? 'Report unavailable.',
        ...errors.map(e => `⚠️ ${e.split('\n')[0]!.slice(0, 200)}`),
        '',
        `${useRuntimeConfig().publicUrl}/scans/${scanId}`,
      ]
      await notify(lines.join('\n'))
    }
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
