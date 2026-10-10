import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = typeof SEVERITIES[number]

export interface Finding {
  tool: 'trivy' | 'semgrep' | 'nuclei'
  severity: Severity
  title: string
  ruleId?: string
  cve?: string
  cwe?: string
  cvss?: number
  location?: string
  description?: string
  remediation?: string
}

function severity(value: unknown): Severity {
  const v = String(value ?? '').toLowerCase()
  return SEVERITIES.find(s => s === v) ?? 'info'
}

function joinList(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : undefined
  return typeof value === 'string' && value ? value : undefined
}

function clip(value: unknown, max = 2000) {
  return typeof value === 'string' && value ? value.slice(0, max) : undefined
}

function bestCvss(cvss: Record<string, { V3Score?: number, V40Score?: number }> | undefined) {
  const scores = Object.values(cvss ?? {})
    .map(c => c.V40Score ?? c.V3Score)
    .filter((n): n is number => typeof n === 'number')
  return scores.length ? Math.max(...scores) : undefined
}

// Dépendances, secrets et mauvaises configurations du dépôt
export async function trivy(dir: string): Promise<Finding[]> {
  const result = await run(
    'trivy',
    ['fs', '--quiet', '--format', 'json', '--scanners', 'vuln,secret,misconfig', '--skip-dirs', '.git', dir],
    { timeoutMs: 15 * 60_000 },
  )
  if (result.code !== 0) throw new Error(result.stderr.trim().slice(-500))
  const json = JSON.parse(result.stdout)
  const findings: Finding[] = []

  for (const res of json.Results ?? []) {
    for (const v of res.Vulnerabilities ?? []) {
      findings.push({
        tool: 'trivy',
        severity: severity(v.Severity),
        title: `${v.PkgName} ${v.InstalledVersion} : ${v.Title ?? v.VulnerabilityID}`,
        ruleId: v.VulnerabilityID,
        cve: String(v.VulnerabilityID).startsWith('CVE-') ? v.VulnerabilityID : undefined,
        cwe: joinList(v.CweIDs),
        cvss: bestCvss(v.CVSS),
        location: res.Target,
        description: clip(v.Description),
        remediation: v.FixedVersion
          ? `Mettre à jour ${v.PkgName} vers ${v.FixedVersion}`
          : 'Pas encore de version corrigée',
      })
    }
    // Le contenu du secret n'est jamais stocké, seulement son emplacement
    for (const s of res.Secrets ?? []) {
      findings.push({
        tool: 'trivy',
        severity: severity(s.Severity),
        title: `Secret : ${s.Title}`,
        ruleId: s.RuleID,
        location: `${res.Target}:${s.StartLine}`,
        remediation: 'Révoquer le secret, puis le retirer de l’historique Git',
      })
    }
    for (const m of res.Misconfigurations ?? []) {
      findings.push({
        tool: 'trivy',
        severity: severity(m.Severity),
        title: m.Title,
        ruleId: m.AVDID ?? m.ID,
        location: m.CauseMetadata?.StartLine ? `${res.Target}:${m.CauseMetadata.StartLine}` : res.Target,
        description: clip(m.Message),
        remediation: clip(m.Resolution),
      })
    }
  }
  return findings
}

const SEMGREP_SEVERITY: Record<string, Severity> = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }

// Analyse statique du code
export async function semgrep(dir: string): Promise<Finding[]> {
  const result = await run(
    'semgrep',
    ['scan', '--config', 'p/default', '--json', '--quiet', '--metrics', 'off', '--timeout', '30', '.'],
    { cwd: dir, timeoutMs: 20 * 60_000 },
  )
  // 0 : rien trouvé, 1 : findings
  if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim().slice(-500))
  const json = JSON.parse(result.stdout)

  return (json.results ?? []).map((r: any): Finding => ({
    tool: 'semgrep',
    severity: SEMGREP_SEVERITY[r.extra?.severity] ?? 'info',
    title: clip(r.extra?.metadata?.shortDescription, 300) ?? String(r.check_id).split('.').pop()!,
    ruleId: r.check_id,
    cwe: joinList(r.extra?.metadata?.cwe),
    location: `${r.path}:${r.start?.line}`,
    description: clip(r.extra?.message),
    remediation: r.extra?.fix ? `Correctif proposé : ${clip(r.extra.fix, 500)}` : undefined,
  }))
}

// Le site en ligne. Pas de templates intrusifs, débit limité
export async function nuclei(url: string, authHeader: string | null, workDir: string): Promise<Finding[]> {
  const args = [
    '-u', url,
    '-jsonl', '-silent', '-nc',
    '-pt', 'http,ssl,dns',
    '-etags', 'dos,fuzz,intrusive,bruteforce',
    '-rl', '30',
    '-timeout', '10',
  ]
  // Les identifiants passent par un fichier 0600, limité au domaine, jamais sur la ligne de commande
  if (authHeader) {
    const { key, value } = parseAuthHeader(authHeader)
    const file = join(workDir, 'nuclei-secrets.yaml')
    const secrets = { static: [{ type: 'header', domains: [new URL(url).hostname], headers: [{ key, value }] }] }
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 })
    args.push('-sf', file)
  }
  const result = await run('nuclei', args, { timeoutMs: 45 * 60_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim().slice(-500))

  const findings: Finding[] = []
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue
    let r: any
    try {
      r = JSON.parse(line)
    }
    catch {
      continue
    }
    const c = r.info?.classification ?? {}
    // Un même template sort plusieurs lignes : le matcher ou la valeur extraite les distingue
    const detail = r['matcher-name'] ?? joinList(r['extracted-results'])
    findings.push({
      tool: 'nuclei',
      severity: severity(r.info?.severity),
      title: `${r.info?.name ?? r['template-id']}${detail ? ` : ${String(detail).slice(0, 100)}` : ''}`,
      ruleId: r['template-id'],
      cve: joinList(c['cve-id']),
      cwe: joinList(c['cwe-id']),
      cvss: typeof c['cvss-score'] === 'number' ? c['cvss-score'] : undefined,
      location: r['matched-at'],
      description: clip(r.info?.description),
      remediation: clip(r.info?.remediation),
    })
  }
  return findings
}
