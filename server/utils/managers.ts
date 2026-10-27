import { parseDocument } from 'yaml'
import { type Bump, compareVersions, parseVersion } from './versions'

// Package managers for dependency fixes. Pure functions, covered by test/managers.test.ts.
// npm runs from the image, pnpm and Yarn through corepack at the version the project uses.
// No code from the repository runs: no install scripts, no pnpmfile, no yarnPath, no Yarn plugins

export type ManagerKind = 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry'

export interface Manager {
  kind: ManagerKind
  label: string
  lockfile: string
  major: number
  // packageManager in package.json names this manager: corepack picks its exact version
  pinned: boolean
}

export interface Manifests {
  pkg: Record<string, any>
  workspace?: string
}

export interface Skipped { bump: Bump, reason: string }

export type Read = (file: string) => string | undefined

const LOCKFILES = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' } as const
type Family = keyof typeof LOCKFILES

const FILES: Record<ManagerKind, string[]> = {
  'npm': ['package.json', 'package-lock.json'],
  'pnpm': ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  'yarn-classic': ['package.json', 'yarn.lock'],
  'yarn-berry': ['package.json', 'yarn.lock'],
}

// Files a fix may change, to reset between attempts and to commit
export const managerFiles = (m: Manager) => FILES[m.kind]

function parsePackageManager(field: unknown) {
  const match = /^(npm|pnpm|yarn)@(\d+)\./.exec(String(field ?? ''))
  return match ? { family: match[1] as Family, major: Number(match[2]) } : undefined
}

// pnpm-lock.yaml without packageManager: the oldest pnpm that writes this format.
// 9.0 maps to pnpm 10, which reads overrides from both package.json and pnpm-workspace.yaml
function pnpmMajorFromLock(lock: string) {
  const version = /^lockfileVersion:\s*'?(\d+)\.(\d+)/m.exec(lock)
  const [major, minor] = [Number(version?.[1]), Number(version?.[2])]
  if (major === 9) return 10
  if (major === 6) return 8
  if (major === 5 && minor >= 4) return 7
  return undefined
}

// yarn.lock from Yarn 2 and later carries a __metadata block with the cache version
function berryMajorFromLock(lock: string) {
  const version = Number(/^__metadata:\n {2}version: (\d+)/m.exec(lock)?.[1])
  if (version >= 8) return 4
  if (version >= 6) return 3
  return 2
}

export function detectManager(pkg: Record<string, any>, read: Read): Manager | { error: string } {
  const field = parsePackageManager(pkg.packageManager)
  const present = (Object.keys(LOCKFILES) as Family[]).filter(f => read(LOCKFILES[f]) !== undefined)
  let family: Family
  if (field) {
    family = field.family
    if (!present.includes(family)) return { error: `packageManager is ${family}, but there is no ${LOCKFILES[family]} at the root` }
  }
  else if (present.length === 1) {
    family = present[0]!
  }
  else if (present.length > 1) {
    return { error: `Several lockfiles at the root: ${present.map(f => LOCKFILES[f]).join(', ')}. Set packageManager in package.json` }
  }
  else {
    return { error: 'No lockfile at the root: dependency fixes need package-lock.json, pnpm-lock.yaml or yarn.lock' }
  }

  const lockfile = LOCKFILES[family]
  const lock = read(lockfile)!
  const pinned = Boolean(field)
  if (family === 'npm') return { kind: 'npm', label: 'npm', lockfile, major: field?.major ?? 0, pinned }

  if (family === 'pnpm') {
    const major = field?.major ?? pnpmMajorFromLock(lock)
    if (!major || major < 7) return { error: 'pnpm-lock.yaml format not supported: pnpm 7 or later is required' }
    return { kind: 'pnpm', label: `pnpm ${major}`, lockfile, major, pinned }
  }

  const berry = /^__metadata:/m.test(lock)
  const major = field?.major ?? (berry ? berryMajorFromLock(lock) : 1)
  if (berry !== (major >= 2)) return { error: `yarn.lock does not match Yarn ${major} from packageManager` }
  return { kind: berry ? 'yarn-berry' : 'yarn-classic', label: `Yarn ${major}`, lockfile, major, pinned }
}

// Settings from the repository that would run its code during an install
export function unsafeConfig(m: Manager, read: Read) {
  if (m.kind === 'yarn-berry' && /^plugins:/m.test(read('.yarnrc.yml') ?? '')) {
    return 'Yarn plugins in .yarnrc.yml would run code from the repository: upgrade by hand'
  }
  return undefined
}

const COREPACK_ENV = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  // Never adds packageManager to package.json
  COREPACK_ENABLE_AUTO_PIN: '0',
  // yarnPath in .yarnrc or .yarnrc.yml points to a script from the repository
  YARN_IGNORE_PATH: '1',
  YARN_ENABLE_SCRIPTS: '0',
  YARN_ENABLE_TELEMETRY: '0',
}

const NPM_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund']
const PNPM_FLAGS = ['--lockfile-only', '--ignore-scripts', '--ignore-pnpmfile']
const YARN_FLAGS = ['--ignore-scripts', '--ignore-engines', '--non-interactive', '--no-progress']

export interface Commands {
  bin: string
  env: Record<string, string>
  // Regenerates the lockfile, then checks it installs as is, the way the host will install it
  lock: string[]
  verify: string[]
  // Output of a failed lock that points at the bumps rather than at the project
  conflict: RegExp
}

export function managerCommands(m: Manager): Commands {
  if (m.kind === 'npm') {
    return {
      bin: 'npm',
      env: {},
      lock: ['install', '--package-lock-only', ...NPM_FLAGS],
      verify: ['ci', '--dry-run', ...NPM_FLAGS],
      conflict: /ERESOLVE/,
    }
  }
  const name = m.kind === 'pnpm' ? 'pnpm' : 'yarn'
  const tool = m.pinned ? name : `${name}@${m.major}`
  const base = { bin: 'corepack', env: COREPACK_ENV }
  if (m.kind === 'pnpm') {
    return {
      ...base,
      lock: [tool, 'install', ...PNPM_FLAGS, '--no-frozen-lockfile'],
      verify: [tool, 'install', ...PNPM_FLAGS, '--frozen-lockfile'],
      conflict: /ERR_PNPM_(PEER_DEP_ISSUES|NO_MATCHING_VERSION)/,
    }
  }
  if (m.kind === 'yarn-classic') {
    // Yarn 1 has no lockfile only mode: it installs node_modules, scripts off
    return {
      ...base,
      lock: [tool, 'install', ...YARN_FLAGS],
      verify: [tool, 'install', '--frozen-lockfile', ...YARN_FLAGS],
      conflict: /Couldn't find any versions|Couldn't find match/,
    }
  }
  return {
    ...base,
    lock: [tool, 'install', '--mode=update-lockfile'],
    verify: [tool, 'install', '--immutable', '--mode=skip-build'],
    conflict: /YN0082/,
  }
}

export interface LockEntry { descriptors: string[], version: string }

// yarn.lock, both formats: `name@range, name@range:` headers, then `version "x"` or `version: x`
export function parseYarnLock(text: string): LockEntry[] {
  const entries: LockEntry[] = []
  let current: LockEntry | undefined
  for (const line of text.split('\n')) {
    if (/^[^\s#].*:$/.test(line)) {
      current = { descriptors: line.slice(0, -1).split(/,\s*/).map(d => d.replace(/^"|"$/g, '')), version: '' }
      if (current.descriptors[0] !== '__metadata') entries.push(current)
    }
    else if (current && !current.version) {
      const match = /^ {2}version:? "?([^"\s]+)"?$/.exec(line)
      if (match) current.version = match[1]!
    }
  }
  return entries
}

// "@scope/pkg@npm:^1.0.0" → name "@scope/pkg", range "npm:^1.0.0"
export function splitDescriptor(descriptor: string) {
  const at = descriptor.indexOf('@', 1)
  return at < 0 ? { name: descriptor, range: '' } : { name: descriptor.slice(0, at), range: descriptor.slice(at + 1) }
}

function yarnResolutions(m: Manager, lock: string, b: Bump): Record<string, string> | string {
  const entries = parseYarnLock(lock)
  const own = entries.filter(e => e.descriptors.some(d => splitDescriptor(d).name === b.name))
  if (m.kind === 'yarn-classic') {
    // Yarn 1 resolutions match a name, not a version: every locked copy moves to the new version
    const others = [...new Set(own.map(e => e.version))].filter(v => v !== b.from)
    const blocking = others.filter(v => parseVersion(v)[0] !== parseVersion(b.from)[0] || compareVersions(v, b.to) > 0)
    if (blocking.length) return `other versions are locked (${blocking.join(', ')}), a Yarn 1 resolution would force them all`
    return { [b.name]: b.to }
  }
  // Yarn 2+: one resolution per descriptor that resolved to the vulnerable version
  const ranges = own.filter(e => e.version === b.from)
    .flatMap(e => e.descriptors.map(splitDescriptor))
    .filter(d => d.name === b.name && /^(npm:)?[^:@]+$/.test(d.range))
    .map(d => d.range.replace(/^npm:/, ''))
  if (!ranges.length) return 'not found as an npm dependency in yarn.lock'
  return Object.fromEntries(ranges.map(r => [`${b.name}@${r}`, b.to]))
}

// pnpm 11 and later only read pnpm-workspace.yaml. pnpm 10 reads both: keep the file in use
function pnpmInWorkspace(m: Manager, files: Manifests) {
  if (m.major >= 11) return true
  if (m.major <= 9) return false
  return parseDocument(files.workspace ?? '').hasIn(['overrides'])
}

// Direct dependencies get a new range. Transitive ones get an override scoped to the vulnerable version
export function applyBumps(m: Manager, files: Manifests, lock: string, bumps: Bump[]) {
  const pkg = structuredClone(files.pkg)
  const workspace = parseDocument(files.workspace ?? '')
  const skipped: Skipped[] = []
  const toWorkspace = m.kind === 'pnpm' && pnpmInWorkspace(m, files)
  let workspaceChanged = false
  for (const b of bumps) {
    if (b.direct) {
      for (const section of ['dependencies', 'devDependencies']) {
        if (pkg[section]?.[b.name]) pkg[section][b.name] = `^${b.to}`
      }
      continue
    }
    const key = `${b.name}@${b.from}`
    if (m.kind === 'npm') {
      pkg.overrides = { ...pkg.overrides, [key]: b.to }
    }
    else if (toWorkspace) {
      workspace.setIn(['overrides', key], b.to)
      workspaceChanged = true
    }
    else if (m.kind === 'pnpm') {
      pkg.pnpm = { ...pkg.pnpm, overrides: { ...pkg.pnpm?.overrides, [key]: b.to } }
    }
    else {
      const resolutions = yarnResolutions(m, lock, b)
      if (typeof resolutions === 'string') skipped.push({ bump: b, reason: resolutions })
      else pkg.resolutions = { ...pkg.resolutions, ...resolutions }
    }
  }
  return {
    pkg,
    workspace: workspaceChanged ? String(workspace) : files.workspace,
    skipped,
  }
}
