import { describe, expect, it } from 'vitest'
import { lockfileVulns, parseGrype, parseNuclei, parseSemgrep, parseTrivy } from '../server/utils/scanners'
import { countBySeverity, formatCounts, verdictOf } from '../server/utils/report'

describe('parseTrivy', () => {
  const findings = parseTrivy({
    Results: [{
      Target: '.env.production',
      Secrets: [{ RuleID: 'aws-access-key-id', Title: 'AWS Access Key', Severity: 'CRITICAL', StartLine: 3, Match: 'AKIAXXXXXXXXXXXXXXXX' }],
    }, {
      Target: 'Dockerfile',
      Misconfigurations: [{ AVDID: 'AVD-DS-0002', Title: 'Image user should not be root', Severity: 'unknown-level', CauseMetadata: {} }],
    }],
  })

  it('never stores the secret value', () => {
    expect(JSON.stringify(findings)).not.toContain('AKIA')
    expect(findings[0]).toMatchObject({ tool: 'trivy', severity: 'critical', title: 'Secret: AWS Access Key', location: '.env.production:3' })
  })

  it('maps unknown severities to info', () => {
    expect(findings[1]).toMatchObject({ severity: 'info', location: 'Dockerfile', ruleId: 'AVD-DS-0002' })
  })

  it('handles an empty report', () => {
    expect(parseTrivy({})).toEqual([])
  })
})

describe('parseGrype', () => {
  // Trimmed from real `grype sbom:... --by-cve -o json` output
  const [fixed, unfixed] = parseGrype({
    matches: [{
      vulnerability: {
        id: 'CVE-2026-102827',
        severity: 'High',
        description: 'simple-git: unsafe-operations plugin bypass',
        cvss: [{ metrics: { baseScore: 8.1 } }, { metrics: { baseScore: 7.2 } }],
        cwes: [{ cwe: 'CWE-77' }, { cwe: 'CWE-88' }, { cwe: 'CWE-77' }],
        fix: { versions: ['4.0.0'], state: 'fixed' },
      },
      artifact: { name: 'simple-git', version: '3.36.0', locations: [{ path: '/pnpm-lock.yaml' }] },
    }, {
      vulnerability: { id: 'GHSA-aaaa-bbbb-cccc', severity: 'Negligible', fix: { versions: [], state: 'not-fixed' } },
      artifact: { name: 'node-forge', version: '1.4.0', locations: [] },
    }],
  })

  it('normalises a fixed vulnerability', () => {
    expect(fixed).toMatchObject({
      tool: 'grype',
      severity: 'high',
      title: 'simple-git 3.36.0: simple-git: unsafe-operations plugin bypass',
      cve: 'CVE-2026-102827',
      cwe: 'CWE-77, CWE-88',
      cvss: 8.1,
      location: 'pnpm-lock.yaml',
      remediation: 'Upgrade simple-git to 4.0.0',
    })
  })

  it('maps negligible to info and keeps unfixed ones', () => {
    expect(unfixed).toMatchObject({ severity: 'info', cve: undefined, location: undefined, remediation: 'No fixed version yet', title: 'node-forge 1.4.0: GHSA-aaaa-bbbb-cccc' })
  })
})

describe('lockfileVulns', () => {
  it('keeps the root lockfile only, with fixed versions', () => {
    const vulns = lockfileVulns({
      matches: [
        { vulnerability: { id: 'CVE-1', severity: 'High', fix: { state: 'fixed', versions: ['2.0.8'] } }, artifact: { name: 'proxy-addr', version: '2.0.7', locations: [{ path: '/package-lock.json' }] } },
        { vulnerability: { id: 'CVE-2', severity: 'Low', fix: { state: 'not-fixed', versions: [] } }, artifact: { name: 'left-pad', version: '1.0.0', locations: [{ path: '/package-lock.json' }] } },
        { vulnerability: { id: 'CVE-3', severity: 'High', fix: { state: 'fixed', versions: ['1.1.0'] } }, artifact: { name: 'nested', version: '1.0.0', locations: [{ path: '/apps/web/package-lock.json' }] } },
      ],
    }, 'package-lock.json')
    expect(vulns).toEqual([
      { name: 'proxy-addr', installed: '2.0.7', fixed: ['2.0.8'], id: 'CVE-1', severity: 'high' },
      { name: 'left-pad', installed: '1.0.0', fixed: [], id: 'CVE-2', severity: 'low' },
    ])
  })
})

describe('parseSemgrep', () => {
  it('maps severities and locations', () => {
    const [f] = parseSemgrep({
      results: [{
        check_id: 'javascript.express.security.audit.xss.direct-response-write',
        path: 'src/app.js',
        start: { line: 12 },
        extra: { severity: 'ERROR', message: 'User input flows into res.send', metadata: { cwe: ['CWE-79'] } },
      }],
    })
    expect(f).toMatchObject({
      tool: 'semgrep',
      severity: 'high',
      title: 'direct-response-write',
      cwe: 'CWE-79',
      location: 'src/app.js:12',
    })
  })
})

describe('parseNuclei', () => {
  it('reads JSONL and skips garbage lines', () => {
    const jsonl = [
      JSON.stringify({ 'template-id': 'http-missing-security-headers', 'matcher-name': 'x-frame-options', 'matched-at': 'https://example.com', 'info': { name: 'HTTP Missing Security Headers', severity: 'info' } }),
      'not json',
      '',
      JSON.stringify({ 'template-id': 'CVE-2021-0001', 'matched-at': 'https://example.com/x', 'info': { name: 'Some CVE', severity: 'critical', classification: { 'cve-id': ['CVE-2021-0001'], 'cvss-score': 9.8 } } }),
    ].join('\n')
    const findings = parseNuclei(jsonl)
    expect(findings).toHaveLength(2)
    // fix.ts relies on this exact title to add missing headers
    expect(findings[0]!.title).toBe('HTTP Missing Security Headers : x-frame-options')
    expect(findings[1]).toMatchObject({ severity: 'critical', cve: 'CVE-2021-0001', cvss: 9.8 })
  })
})

describe('report helpers', () => {
  it('counts and formats by severity', () => {
    const counts = countBySeverity([{ severity: 'high' }, { severity: 'high' }, { severity: 'low' }])
    expect(formatCounts(counts)).toBe('2 high, 1 low')
    expect(formatCounts(countBySeverity([]))).toBe('no findings')
  })

  it('extracts the verdict line', () => {
    expect(verdictOf('Verdict: fix the redirect.\n- express: upgrade')).toBe('fix the redirect.')
    expect(verdictOf(null)).toBeNull()
  })
})
