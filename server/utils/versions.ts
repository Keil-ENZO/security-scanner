// Version picking for npm fixes. Pure functions, covered by test/versions.test.ts

export interface Vuln { name: string, installed: string, fixed: string[], id: string, severity: string }
export interface Bump { name: string, from: string, to: string, direct: boolean, major: boolean, ids: string[] }

export function parseVersion(v: string) {
  return v.replace(/^[^\d]*/, '').split(/[-+]/)[0]!.split('.').map(n => Number(n) || 0)
}

export function compareVersions(a: string, b: string) {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

// Out of "2.3.3, 3.0.4": the lowest fixed version on the same major, else the lowest overall
export function pickFixed(installed: string, candidates: string[]) {
  const above = candidates.filter(c => compareVersions(c, installed) > 0).sort(compareVersions)
  const major = parseVersion(installed)[0]
  return above.find(c => parseVersion(c)[0] === major) ?? above[0]
}

export function planBumps(vulns: Vuln[], pkg: { dependencies?: object, devDependencies?: object }) {
  const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
  const bumps = new Map<string, Bump>()
  const unfixable: Vuln[] = []
  for (const v of vulns) {
    const to = pickFixed(v.installed, v.fixed)
    if (!to) {
      unfixable.push(v)
      continue
    }
    const key = `${v.name}@${v.installed}`
    const bump = bumps.get(key)
    if (bump) {
      // Several CVEs on one package: the highest version covers them all
      if (compareVersions(to, bump.to) > 0) bump.to = to
      bump.ids.push(v.id)
    }
    else {
      bumps.set(key, { name: v.name, from: v.installed, to, direct: direct.has(v.name), major: false, ids: [v.id] })
    }
  }
  const safe: Bump[] = []
  const majors: Bump[] = []
  for (const b of bumps.values()) {
    b.major = parseVersion(b.to)[0] !== parseVersion(b.from)[0]
    // Forcing a major on a transitive dependency breaks the parent, which expects the old one
    if (b.major && !b.direct) majors.push(b)
    else safe.push(b)
  }
  return { bumps: safe, unfixable, majors }
}

// CVEs of a bump that Grype no longer sees, neither on the old version nor on the new one.
// The same id on another package, or on an older copy left alone, says nothing about this bump
export function fixedBy(b: Bump, after: Vuln[]) {
  const ours = (v: Vuln) => v.name === b.name && (v.installed === b.from || compareVersions(v.installed, b.to) >= 0)
  const left = new Set(after.filter(ours).map(v => v.id))
  return b.ids.filter(id => !left.has(id))
}
