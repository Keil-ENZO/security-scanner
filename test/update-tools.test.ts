import { describe, expect, it } from 'vitest'
import { dropRules, pickRelease, readEnv, TOOLS, writeEnv } from '../scripts/update-tools.mjs'

const now = new Date('2026-11-01T00:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

describe('tools.env', () => {
  const env = '# Pinned\nNUCLEI_VERSION=3.11.1\nCOSIGN_SHA256=abc\n'

  it('reads every key and leaves comments alone', () => {
    expect(readEnv(env)).toEqual({ NUCLEI_VERSION: '3.11.1', COSIGN_SHA256: 'abc' })
    expect(writeEnv(env, 'NUCLEI_VERSION', '3.12.0')).toBe('# Pinned\nNUCLEI_VERSION=3.12.0\nCOSIGN_SHA256=abc\n')
  })

  it('refuses a key it does not know', () => {
    expect(() => writeEnv(env, 'TRIVY_VERSION', '1.0.0')).toThrow(/TRIVY_VERSION/)
  })

  it('covers every version of the real file', async () => {
    const { readFileSync } = await import('node:fs')
    const keys = Object.keys(readEnv(readFileSync(new URL('../scripts/tools.env', import.meta.url), 'utf8')))
    expect(keys.filter(k => k.endsWith('_VERSION')).sort()).toEqual(TOOLS.map(t => t.key).sort())
  })
})

describe('pickRelease', () => {
  it('takes the newest release past the cooldown', () => {
    const releases = [
      { version: '1.2.0', published: daysAgo(30) },
      { version: '1.3.0', published: daysAgo(8) },
      { version: '1.4.0', published: daysAgo(2) },
    ]
    expect(pickRelease(releases, '1.2.0', now).next?.version).toBe('1.3.0')
  })

  it('skips prereleases and versions it cannot read', () => {
    const releases = [
      { version: '1.3.0-rc.1', published: daysAgo(20) },
      { version: 'nightly', published: daysAgo(20) },
    ]
    expect(pickRelease(releases, '1.2.0', now).next).toBeUndefined()
  })

  it('never goes back, never jumps a major', () => {
    const releases = [
      { version: '1.1.0', published: daysAgo(90) },
      { version: '2.0.0', published: daysAgo(30) },
      { version: '2.1.0', published: daysAgo(20) },
    ]
    const pick = pickRelease(releases, '1.2.0', now)
    expect(pick.next).toBeUndefined()
    expect(pick.major?.version).toBe('2.1.0')
  })

  it('keeps patch releases of an older major apart', () => {
    // cosign publishes 2.x patches next to 3.x
    const releases = [{ version: '2.6.5', published: daysAgo(20) }, { version: '3.1.4', published: daysAgo(20) }]
    expect(pickRelease(releases, '3.1.3', now).next?.version).toBe('3.1.4')
  })
})

describe('dropRules', () => {
  const grype = `# Accepted risks
ignore:

  # grype 0.121.0: old Go
  - vulnerability: CVE-1
    package:
      location: "/usr/local/bin/grype"

  # nuclei 3.11.1: old Go
  - vulnerability: CVE-2
    package:
      location: "/usr/local/bin/nuclei"

  # npm 11.21.1: undici
  - vulnerability: CVE-3
    package:
      location: "/usr/local/lib/node_modules/npm/node_modules/undici/package.json"
`

  it('removes the first block with its comment', () => {
    const { text, removed } = dropRules(grype, ['/usr/local/bin/grype'])
    expect(removed).toBe(1)
    expect(text).not.toMatch(/grype|CVE-1/)
    expect(text).toMatch(/^ignore:\n\n {2}# nuclei 3\.11\.1: old Go\n {2}- vulnerability: CVE-2\n/m)
  })

  it('matches a directory by prefix and a binary exactly', () => {
    const { text, removed } = dropRules(grype, ['/usr/local/lib/node_modules/npm/', '/usr/local/bin/nucle'])
    expect(removed).toBe(1)
    expect(text).not.toMatch(/undici|npm 11/)
    expect(text).toMatch(/CVE-2/)
  })

  it('leaves the file as is when nothing matches', () => {
    expect(dropRules(grype, ['/usr/local/bin/trivy'])).toEqual({ text: grype, removed: 0 })
  })
})
