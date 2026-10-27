import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyBumps, detectManager, type Manager, managerCommands, managerFiles, parseYarnLock, splitDescriptor, unsafeConfig } from '../server/utils/managers'
import type { Bump } from '../server/utils/versions'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/lockfiles/${name}`, import.meta.url), 'utf8')
const files = (map: Record<string, string>) => (file: string) => map[file]

const manager = (m: Manager | { error: string }) => {
  if ('error' in m) throw new Error(m.error)
  return m
}

const bump = (name: string, from: string, to: string, direct = false): Bump =>
  ({ name, from, to, direct, major: false, ids: ['CVE-1'] })

describe('detectManager', () => {
  it('picks the only lockfile at the root', () => {
    expect(manager(detectManager({}, files({ 'package-lock.json': '{}' })))).toMatchObject({ kind: 'npm', lockfile: 'package-lock.json', pinned: false })
    expect(manager(detectManager({}, files({ 'yarn.lock': fixture('yarn-classic.lock') })))).toMatchObject({ kind: 'yarn-classic', major: 1 })
  })

  it('maps the pnpm lockfile format to the oldest pnpm that writes it', () => {
    expect(manager(detectManager({}, files({ 'pnpm-lock.yaml': fixture('pnpm-9.yaml') }))).major).toBe(10)
    expect(manager(detectManager({}, files({ 'pnpm-lock.yaml': fixture('pnpm-6.yaml') }))).major).toBe(8)
    expect(manager(detectManager({}, files({ 'pnpm-lock.yaml': fixture('pnpm-5.yaml') }))).major).toBe(7)
    expect(detectManager({}, files({ 'pnpm-lock.yaml': fixture('pnpm-old.yaml') }))).toHaveProperty('error')
  })

  it('maps the Yarn Berry cache version to its major', () => {
    expect(manager(detectManager({}, files({ 'yarn.lock': fixture('yarn-berry.lock') })))).toMatchObject({ kind: 'yarn-berry', label: 'Yarn 4', major: 4 })
  })

  it('trusts packageManager over the lockfiles present', () => {
    const read = files({ 'package-lock.json': '{}', 'pnpm-lock.yaml': fixture('pnpm-9.yaml') })
    expect(manager(detectManager({ packageManager: 'pnpm@9.15.9+sha512.abc' }, read))).toMatchObject({ kind: 'pnpm', major: 9, pinned: true })
    expect(detectManager({ packageManager: 'yarn@4.1.0' }, read)).toEqual({ error: 'packageManager is yarn, but there is no yarn.lock at the root' })
  })

  it('refuses to guess between several lockfiles', () => {
    const result = detectManager({}, files({ 'package-lock.json': '{}', 'yarn.lock': '' }))
    expect(result).toEqual({ error: 'Several lockfiles at the root: package-lock.json, yarn.lock. Set packageManager in package.json' })
  })

  it('refuses a yarn.lock that does not match packageManager', () => {
    expect(detectManager({ packageManager: 'yarn@1.22.22' }, files({ 'yarn.lock': fixture('yarn-berry.lock') }))).toHaveProperty('error')
    expect(detectManager({ packageManager: 'yarn@4.1.0' }, files({ 'yarn.lock': fixture('yarn-classic.lock') }))).toHaveProperty('error')
  })

  it('needs a lockfile', () => {
    expect(detectManager({}, files({}))).toHaveProperty('error')
  })
})

describe('managerCommands', () => {
  const berry = manager(detectManager({}, files({ 'yarn.lock': fixture('yarn-berry.lock') })))
  const pnpm = manager(detectManager({}, files({ 'pnpm-lock.yaml': fixture('pnpm-9.yaml') })))

  it('never runs scripts nor code from the repository', () => {
    const p = managerCommands(pnpm)
    expect(p.lock).toEqual(expect.arrayContaining(['--ignore-scripts', '--ignore-pnpmfile', '--lockfile-only']))
    expect(p.verify).toContain('--frozen-lockfile')
    const y = managerCommands(berry)
    expect(y.env).toMatchObject({ YARN_ENABLE_SCRIPTS: '0', YARN_IGNORE_PATH: '1', COREPACK_ENABLE_AUTO_PIN: '0' })
    expect(y.verify).toEqual(['yarn@4', 'install', '--immutable', '--mode=skip-build'])
  })

  it('lets corepack read the exact version from packageManager', () => {
    const pinned = manager(detectManager({ packageManager: 'pnpm@10.34.9' }, files({ 'pnpm-lock.yaml': fixture('pnpm-9.yaml') })))
    expect(managerCommands(pinned).lock[0]).toBe('pnpm')
    expect(managerCommands(pnpm).lock[0]).toBe('pnpm@10')
  })

  it('commits the pnpm workspace file only for pnpm', () => {
    expect(managerFiles(pnpm)).toContain('pnpm-workspace.yaml')
    expect(managerFiles(berry)).toEqual(['package.json', 'yarn.lock'])
  })
})

describe('unsafeConfig', () => {
  const berry = manager(detectManager({}, files({ 'yarn.lock': fixture('yarn-berry.lock') })))

  it('refuses Yarn plugins from the repository', () => {
    expect(unsafeConfig(berry, files({ '.yarnrc.yml': 'nodeLinker: node-modules\nplugins:\n  - path: .yarn/plugins/x.cjs\n' }))).toMatch(/plugins/)
    expect(unsafeConfig(berry, files({ '.yarnrc.yml': 'nodeLinker: node-modules\nyarnPath: .yarn/releases/yarn.cjs\n' }))).toBeUndefined()
  })
})

describe('parseYarnLock', () => {
  it('reads Yarn 1 entries, quoted and scoped', () => {
    expect(parseYarnLock(fixture('yarn-classic.lock'))).toEqual([
      { descriptors: ['@babel/core@^7.0.0', '@babel/core@^7.1.0'], version: '7.1.0' },
      { descriptors: ['debug@2.6.9'], version: '2.6.9' },
      { descriptors: ['debug@^4.1.0'], version: '4.3.1' },
      { descriptors: ['qs@6.7.0'], version: '6.7.0' },
    ])
  })

  it('reads Yarn Berry entries and skips the metadata', () => {
    const entries = parseYarnLock(fixture('yarn-berry.lock'))
    expect(entries[0]).toEqual({ descriptors: ['debug@npm:2.6.9', 'debug@npm:^2.2.0'], version: '2.6.9' })
    expect(entries.map(e => e.version)).toEqual(['2.6.9', '6.7.0', '6.7.0', '0.0.0-use.local'])
  })

  it('splits scoped descriptors', () => {
    expect(splitDescriptor('@scope/pkg@npm:^1.0.0')).toEqual({ name: '@scope/pkg', range: 'npm:^1.0.0' })
    expect(splitDescriptor('qs@6.7.0')).toEqual({ name: 'qs', range: '6.7.0' })
  })
})

describe('applyBumps', () => {
  const pkg = { dependencies: { express: '^4.17.0' } }

  it('raises direct dependencies the same way for every manager', () => {
    const m = manager(detectManager({}, files({ 'yarn.lock': fixture('yarn-classic.lock') })))
    const next = applyBumps(m, { pkg }, fixture('yarn-classic.lock'), [bump('express', '4.17.1', '4.20.0', true)])
    expect(next.pkg.dependencies.express).toBe('^4.20.0')
    expect(next.pkg.resolutions).toBeUndefined()
    expect(pkg.dependencies.express).toBe('^4.17.0')
  })

  it('npm: override scoped to the vulnerable version', () => {
    const m = manager(detectManager({}, files({ 'package-lock.json': '{}' })))
    expect(applyBumps(m, { pkg }, '{}', [bump('qs', '6.7.0', '6.7.3')]).pkg.overrides).toEqual({ 'qs@6.7.0': '6.7.3' })
  })

  it('pnpm 9: overrides in package.json', () => {
    const m = manager(detectManager({ packageManager: 'pnpm@9.15.9' }, files({ 'pnpm-lock.yaml': fixture('pnpm-9.yaml') })))
    const next = applyBumps(m, { pkg }, '', [bump('qs', '6.7.0', '6.7.3')])
    expect(next.pkg.pnpm).toEqual({ overrides: { 'qs@6.7.0': '6.7.3' } })
    expect(next.workspace).toBeUndefined()
  })

  it('pnpm 10: keeps the overrides where the project has them', () => {
    const m = manager(detectManager({}, files({ 'pnpm-lock.yaml': fixture('pnpm-9.yaml') })))
    const inPkg = applyBumps(m, { pkg, workspace: 'packages:\n  - app\n' }, '', [bump('qs', '6.7.0', '6.7.3')])
    expect(inPkg.pkg.pnpm.overrides).toEqual({ 'qs@6.7.0': '6.7.3' })
    expect(inPkg.workspace).toBe('packages:\n  - app\n')
    const inWorkspace = applyBumps(m, { pkg, workspace: 'overrides:\n  # pinned\n  ms@2.0.0: 2.1.3\n' }, '', [bump('qs', '6.7.0', '6.7.3')])
    expect(inWorkspace.pkg.pnpm).toBeUndefined()
    expect(inWorkspace.workspace).toBe('overrides:\n  # pinned\n  ms@2.0.0: 2.1.3\n  qs@6.7.0: 6.7.3\n')
  })

  it('pnpm 11 and later: overrides in pnpm-workspace.yaml, created when missing', () => {
    const m = manager(detectManager({ packageManager: 'pnpm@12.15.0' }, files({ 'pnpm-lock.yaml': fixture('pnpm-9.yaml') })))
    const next = applyBumps(m, { pkg }, '', [bump('@scope/pkg', '1.0.0', '1.0.1')])
    expect(next.workspace).toBe('overrides:\n  "@scope/pkg@1.0.0": 1.0.1\n')
    expect(next.pkg.pnpm).toBeUndefined()
    // Only direct bumps: the workspace file is left alone
    expect(applyBumps(m, { pkg }, '', [bump('express', '4.17.1', '4.20.0', true)]).workspace).toBeUndefined()
  })

  it('Yarn 1: resolution on the name, only when no other locked copy would be forced', () => {
    const m = manager(detectManager({}, files({ 'yarn.lock': fixture('yarn-classic.lock') })))
    const lock = fixture('yarn-classic.lock')
    const ok = applyBumps(m, { pkg }, lock, [bump('qs', '6.7.0', '6.7.3')])
    expect(ok.pkg.resolutions).toEqual({ qs: '6.7.3' })
    expect(ok.skipped).toEqual([])
    const blocked = applyBumps(m, { pkg }, lock, [bump('debug', '2.6.9', '2.6.10')])
    expect(blocked.pkg.resolutions).toBeUndefined()
    expect(blocked.skipped[0]!.reason).toMatch(/4\.3\.1/)
  })

  it('Yarn Berry: one resolution per descriptor of the vulnerable version', () => {
    const lock = fixture('yarn-berry.lock')
    const m = manager(detectManager({}, files({ 'yarn.lock': lock })))
    const next = applyBumps(m, { pkg }, lock, [bump('debug', '2.6.9', '2.6.10'), bump('qs', '6.7.0', '6.7.3'), bump('ms', '2.0.0', '2.0.1')])
    expect(next.pkg.resolutions).toEqual({ 'debug@2.6.9': '2.6.10', 'debug@^2.2.0': '2.6.10', 'qs@6.7.0': '6.7.3' })
    expect(next.skipped.map(s => s.bump.name)).toEqual(['ms'])
  })
})
