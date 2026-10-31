import { describe, expect, it } from 'vitest'
import { type Bump, compareVersions, fixedBy, pickFixed, planBumps, type Vuln } from '../server/utils/versions'

describe('compareVersions', () => {
  it('orders semver, ignoring prefixes and pre-release tags', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(0)
    expect(compareVersions('0.9', '0.9.1')).toBeLessThan(0)
  })
})

describe('pickFixed', () => {
  it('prefers the lowest fix on the same major', () => {
    expect(pickFixed('2.3.1', ['3.0.4', '2.3.3', '2.4.0'])).toBe('2.3.3')
  })

  it('falls back to the lowest fix on another major', () => {
    expect(pickFixed('1.0.0', ['3.0.0', '2.1.0'])).toBe('2.1.0')
  })

  it('ignores versions that are not upgrades', () => {
    expect(pickFixed('2.0.0', ['1.9.9', '2.0.0'])).toBeUndefined()
  })
})

describe('planBumps', () => {
  const pkg = { dependencies: { express: '^4.0.0' }, devDependencies: { vite: '^5.0.0' } }

  it('merges several CVEs on one package into the highest version', () => {
    const { bumps } = planBumps([
      { name: 'express', installed: '4.18.0', fixed: ['4.19.2'], id: 'CVE-1', severity: 'high' },
      { name: 'express', installed: '4.18.0', fixed: ['4.20.0'], id: 'CVE-2', severity: 'medium' },
    ], pkg)
    expect(bumps).toEqual([{ name: 'express', from: '4.18.0', to: '4.20.0', direct: true, major: false, ids: ['CVE-1', 'CVE-2'] }])
  })

  it('never forces a major version on a transitive dependency', () => {
    const { bumps, majors } = planBumps([
      { name: 'proxy-addr', installed: '1.0.0', fixed: ['2.0.0'], id: 'CVE-3', severity: 'high' },
    ], pkg)
    expect(bumps).toEqual([])
    expect(majors.map(b => b.name)).toEqual(['proxy-addr'])
  })

  it('allows a major version on a direct dependency, flagged', () => {
    const { bumps } = planBumps([
      { name: 'vite', installed: '5.0.0', fixed: ['6.0.1'], id: 'CVE-4', severity: 'high' },
    ], pkg)
    expect(bumps[0]).toMatchObject({ name: 'vite', direct: true, major: true })
  })

  it('reports vulnerabilities without a fix', () => {
    const { unfixable } = planBumps([
      { name: 'left-pad', installed: '1.0.0', fixed: [], id: 'GHSA-x', severity: 'low' },
    ], pkg)
    expect(unfixable).toHaveLength(1)
  })
})

describe('fixedBy', () => {
  const bump: Bump = { name: 'cookie', from: '0.4.0', to: '0.7.0', direct: false, major: false, ids: ['CVE-1', 'CVE-2'] }
  const vuln = (name: string, installed: string, id: string): Vuln => ({ name, installed, fixed: [], id, severity: 'high' })

  it('credits the ids gone from the bumped version', () => {
    expect(fixedBy(bump, [])).toEqual(['CVE-1', 'CVE-2'])
    expect(fixedBy(bump, [vuln('cookie', '0.4.0', 'CVE-2')])).toEqual(['CVE-1'])
  })

  it('ignores the same id on another package or on an older copy left alone', () => {
    expect(fixedBy(bump, [vuln('other', '1.0.0', 'CVE-1'), vuln('cookie', '0.3.0', 'CVE-1')])).toEqual(['CVE-1', 'CVE-2'])
  })

  it('does not credit an id still seen on the new version', () => {
    expect(fixedBy(bump, [vuln('cookie', '0.7.0', 'CVE-1')])).toEqual(['CVE-2'])
  })
})
