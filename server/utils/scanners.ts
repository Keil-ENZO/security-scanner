import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAuthHeader } from './targets'
import type { Vuln } from './versions'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = typeof SEVERITIES[number]

export interface Finding {
  tool: 'trivy' | 'trufflehog' | 'grype' | 'semgrep' | 'nuclei'
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

function jsonLines(text: string) {
  const records: any[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    }
    catch {
      continue
    }
  }
  return records
}

const CONFIG_FILES = String.raw`(?i)(^|/)((docker-)?compose[^/]*\.ya?ml|\.env(\.[^/]*)?|[^/]*\.env)$`

// The built-in rules only know token formats: a plain password in a compose file goes through.
// The rules below read compose and env files, where a literal value next to such a key is a credential.
// The built-in exceptions would hide test, example and Markdown files
export const TRIVY_SECRET_CONFIG = String.raw`
disable-allow-rules: [tests, examples, markdown]
rules:
  - id: config-credential
    category: Config
    title: Hardcoded credential in a compose or env file
    severity: HIGH
    path: '${CONFIG_FILES}'
    keywords: [pass, pwd, secret, token, key]
    regex: '(?im)^[\s-]*["'']?[a-z0-9_.]*(password|passwd|pwd|secret|token|api_?key|secret_?key|private_?key|access_?key)["'']?\s*[:=]\s*["'']?(?P<secret>[^\s"''#$][^\s"''#]{2,})'
    secret-group-name: secret
    allow-rules:
      - id: placeholder
        description: Placeholder value
        regex: '(?i)[:=]\s*["'']?(change[-_]?me|changeit|example|sample|placeholder|password|secret|token|your[-_][^\s"'']*|x{3,}|\*+|<[^\s]*>|\{\{[^\s]*|true|false|null|none)["'']?\s*$'
  - id: config-url-credential
    category: Config
    title: Credentials in a URL, in a compose or env file
    severity: HIGH
    path: '${CONFIG_FILES}'
    keywords: ['://']
    regex: '(?i)\b[a-z][a-z0-9+.-]*://[^\s:/@"'']*:(?P<secret>[^\s:/@"''$]{3,})@'
    secret-group-name: secret
  - id: config-command-password
    category: Config
    title: Password on a command line, in a compose file
    severity: HIGH
    path: '${CONFIG_FILES}'
    keywords: ['--requirepass', '--masterauth', '--password']
    regex: '(?i)--(requirepass|masterauth|password)[=\s]+["'']?(?P<secret>[^\s"''$]{3,})'
    secret-group-name: secret
`

// Secrets and misconfigurations of the repository. Vulnerabilities come from Grype
export async function trivy(dir: string, workDir: string): Promise<Finding[]> {
  const config = join(workDir, 'trivy-secret.yaml')
  writeFileSync(config, TRIVY_SECRET_CONFIG, { mode: 0o600 })
  const result = await run(
    'trivy',
    ['fs', '--quiet', '--format', 'json', '--scanners', 'secret,misconfig', '--secret-config', config, '--skip-dirs', '.git', dir],
    { timeoutMs: 15 * 60_000 },
  )
  if (result.code !== 0) throw new Error(result.stderr.trim().slice(-500))
  return parseTrivy(JSON.parse(result.stdout))
}

export function parseTrivy(json: any): Finding[] {
  const findings: Finding[] = []
  for (const res of json.Results ?? []) {
    // The secret itself is never stored, only where it is
    for (const s of res.Secrets ?? []) {
      findings.push({
        tool: 'trivy',
        severity: severity(s.Severity),
        title: `Secret: ${s.Title}`,
        ruleId: s.RuleID,
        location: `${res.Target}:${s.StartLine}`,
        remediation: 'Revoke the secret, then remove it from the Git history',
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

// Secrets of the whole Git history. No verification: a candidate never leaves the machine
export async function trufflehog(dir: string): Promise<Finding[]> {
  const result = await run(
    'trufflehog',
    ['git', `file://${dir}`, '--no-verification', '--no-update', '--no-ignore-tag', '--json'],
    { timeoutMs: 20 * 60_000 },
  )
  if (result.code !== 0) throw new Error(result.stderr.trim().slice(-500))
  const records = jsonLines(result.stdout)
  // Tells a secret still in the code from one only left in the history
  const head = new Map<string, string>()
  for (const r of records) {
    const file = String(r.SourceMetadata?.Data?.Git?.file ?? '')
    if (file && !head.has(file)) head.set(file, await git(dir, ['show', `HEAD:${file}`]).catch(() => ''))
  }
  return parseTrufflehog(records, head)
}

export function parseTrufflehog(records: any[], head: Map<string, string>): Finding[] {
  const seen = new Set<string>()
  const findings: Finding[] = []
  for (const r of records) {
    const g = r.SourceMetadata?.Data?.Git ?? {}
    const id = `${r.DetectorName}|${g.file}|${r.Raw}`
    if (seen.has(id)) continue
    seen.add(id)
    // Same rule as Trivy: the secret itself is never stored
    const current = !!r.Raw && !!head.get(g.file)?.includes(r.Raw)
    findings.push({
      tool: 'trufflehog',
      severity: 'high',
      title: `${current ? 'Secret' : 'Secret in Git history'}: ${r.DetectorName} in ${g.file}`,
      ruleId: r.DetectorName,
      location: `${g.file}:${g.line}`,
      description: g.commit ? `Committed in ${String(g.commit).slice(0, 12)}` : undefined,
      remediation: 'Revoke the secret, then remove it from the Git history',
    })
  }
  return findings
}

// Syft and Grype stay quiet and offline about their own updates
const ANCHORE_ENV = { SYFT_CHECK_FOR_APP_UPDATE: 'false', GRYPE_CHECK_FOR_APP_UPDATE: 'false' }

// SBOM of the repository, CycloneDX JSON. Returns the file path
export async function syft(dir: string, workDir: string) {
  const file = join(workDir, 'sbom.cdx.json')
  const result = await run(
    'syft',
    ['scan', `dir:${dir}`, '--quiet', '--exclude', './.git', '-o', `cyclonedx-json=${file}`],
    { env: ANCHORE_ENV, timeoutMs: 10 * 60_000 },
  )
  if (result.code !== 0) throw new Error(result.stderr.trim().slice(-500))
  const content = readFileSync(file, 'utf8')
  const components = (JSON.parse(content).components ?? []).length as number
  return { file, content, components }
}

// Grype JSON report. Source: sbom:<file> for a scan, dir:<path> for a fix
export async function grypeReport(source: string) {
  const result = await run(
    'grype',
    [source, '--quiet', '--by-cve', '-o', 'json'],
    { env: ANCHORE_ENV, timeoutMs: 15 * 60_000 },
  )
  if (result.code !== 0) throw new Error(`grype: ${result.stderr.trim().slice(-500)}`)
  return JSON.parse(result.stdout)
}

// Vulnerabilities of the dependencies, read from the SBOM
export async function grype(sbomFile: string): Promise<Finding[]> {
  return parseGrype(await grypeReport(`sbom:${sbomFile}`))
}

const GRYPE_SEVERITY: Record<string, Severity> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }

export function parseGrype(json: any): Finding[] {
  return (json.matches ?? []).map((m: any): Finding => {
    const v = m.vulnerability ?? {}
    const a = m.artifact ?? {}
    const fixed = v.fix?.state === 'fixed' ? joinList(v.fix.versions) : undefined
    const scores = (v.cvss ?? []).map((c: any) => c.metrics?.baseScore).filter((n: unknown) => typeof n === 'number')
    const cwes = [...new Set((v.cwes ?? []).map((c: any) => c.cwe).filter(Boolean))]
    return {
      tool: 'grype',
      severity: GRYPE_SEVERITY[String(v.severity).toLowerCase()] ?? 'info',
      title: `${a.name} ${a.version}: ${clip(v.description, 200) ?? v.id}`,
      ruleId: v.id,
      cve: String(v.id).startsWith('CVE-') ? v.id : undefined,
      cwe: joinList(cwes),
      cvss: scores.length ? Math.max(...scores) : undefined,
      location: String(a.locations?.[0]?.path ?? '').replace(/^\//, '') || undefined,
      description: clip(v.description),
      remediation: fixed ? `Upgrade ${a.name} to ${fixed}` : 'No fixed version yet',
    }
  })
}

// Input of the npm fixer: vulnerabilities found in one lockfile, at the repository root
export function lockfileVulns(json: any, lockfile: string): Vuln[] {
  return (json.matches ?? [])
    .filter((m: any) => (m.artifact?.locations ?? []).some((l: any) => l.path === `/${lockfile}`))
    .map((m: any): Vuln => ({
      name: m.artifact.name,
      installed: m.artifact.version,
      fixed: m.vulnerability?.fix?.state === 'fixed' ? m.vulnerability.fix.versions ?? [] : [],
      id: m.vulnerability?.id,
      severity: String(m.vulnerability?.severity ?? '').toLowerCase(),
    }))
}

const SEMGREP_SEVERITY: Record<string, Severity> = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }

// Static analysis of the code
export async function semgrep(dir: string): Promise<Finding[]> {
  const result = await run(
    'semgrep',
    ['scan', '--config', 'p/default', '--json', '--quiet', '--metrics', 'off', '--timeout', '30', '.'],
    { cwd: dir, timeoutMs: 20 * 60_000 },
  )
  // 0: nothing found, 1: findings
  if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim().slice(-500))
  return parseSemgrep(JSON.parse(result.stdout))
}

export function parseSemgrep(json: any): Finding[] {
  return (json.results ?? []).map((r: any): Finding => ({
    tool: 'semgrep',
    severity: SEMGREP_SEVERITY[r.extra?.severity] ?? 'info',
    title: clip(r.extra?.metadata?.shortDescription, 300) ?? String(r.check_id).split('.').pop()!,
    ruleId: r.check_id,
    cwe: joinList(r.extra?.metadata?.cwe),
    location: `${r.path}:${r.start?.line}`,
    description: clip(r.extra?.message),
    remediation: r.extra?.fix ? `Suggested fix: ${clip(r.extra.fix, 500)}` : undefined,
  }))
}

// The live site. No intrusive templates, rate limited
export async function nuclei(url: string, authHeader: string | null, workDir: string): Promise<Finding[]> {
  const args = [
    '-u', url,
    '-jsonl', '-silent', '-nc',
    '-pt', 'http,ssl,dns',
    '-etags', 'dos,fuzz,intrusive,bruteforce',
    '-rl', '30',
    '-timeout', '10',
  ]
  // Credentials go through a 0600 file scoped to the domain, never on the command line
  if (authHeader) {
    const { key, value } = parseAuthHeader(authHeader)
    const file = join(workDir, 'nuclei-secrets.yaml')
    const secrets = { static: [{ type: 'header', domains: [new URL(url).hostname], headers: [{ key, value }] }] }
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 })
    args.push('-sf', file)
  }
  const result = await run('nuclei', args, { timeoutMs: 45 * 60_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim().slice(-500))
  return parseNuclei(result.stdout)
}

export function parseNuclei(jsonl: string): Finding[] {
  const findings: Finding[] = []
  for (const r of jsonLines(jsonl)) {
    const c = r.info?.classification ?? {}
    // One template can emit several lines: the matcher or the extracted value tells them apart
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
