// Usage: node scripts/update-tools.mjs <summary.md>
// Weekly bump of scripts/tools.env, run by .github/workflows/tools.yml.
// Each tool moves to its newest release published at least a week ago, on the same major.
// A new major only shows up in the summary: flags and output formats change, it needs a manual review.
// The .grype.yaml rules of a bumped tool are deleted: the release gate then judges the new binary.
// Cosign is the root of trust: the pinned binary verifies the new one before its hash gets pinned
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, major, prerelease, valid } from 'semver'
import { parseDocument } from 'yaml'

// A fresh release can be a hijacked one, same rule as Dependabot
export const COOLDOWN_DAYS = 7

// key in tools.env, where releases are listed, where the tool lands in the image for .grype.yaml
export const TOOLS = [
  { key: 'NUCLEI_VERSION', name: 'nuclei', github: 'projectdiscovery/nuclei', location: '/usr/local/bin/nuclei' },
  { key: 'TRIVY_VERSION', name: 'trivy', github: 'aquasecurity/trivy', location: '/usr/local/bin/trivy' },
  { key: 'SYFT_VERSION', name: 'syft', github: 'anchore/syft', location: '/usr/local/bin/syft' },
  { key: 'GRYPE_VERSION', name: 'grype', github: 'anchore/grype', location: '/usr/local/bin/grype' },
  { key: 'COSIGN_VERSION', name: 'cosign', github: 'sigstore/cosign', location: '/usr/local/bin/cosign' },
  { key: 'NPM_VERSION', name: 'npm', npm: 'npm', location: '/usr/local/lib/node_modules/npm/' },
  { key: 'COREPACK_VERSION', name: 'corepack', npm: 'corepack', location: '/usr/local/lib/node_modules/corepack/' },
  { key: 'SEMGREP_VERSION', name: 'semgrep', pypi: 'semgrep', location: '/opt/uv/tools/semgrep/' },
]

export function readEnv(text) {
  return Object.fromEntries([...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map(m => [m[1], m[2]]))
}

export function writeEnv(text, key, value) {
  const line = new RegExp(`^${key}=.*$`, 'm')
  if (!line.test(text)) throw new Error(`${key} missing from tools.env`)
  return text.replace(line, `${key}=${value}`)
}

// releases: [{ version, published }]. The newest stable release past the cooldown, on the current
// major, and the newest major beyond it for the summary
export function pickRelease(releases, current, now = new Date()) {
  const cutoff = now.getTime() - COOLDOWN_DAYS * 86_400_000
  const ripe = releases
    .filter(r => valid(r.version) && !prerelease(r.version) && Date.parse(r.published) <= cutoff)
    .filter(r => compare(r.version, current) > 0)
    .sort((a, b) => compare(b.version, a.version))
  return {
    next: ripe.find(r => major(r.version) === major(current)),
    major: ripe.find(r => major(r.version) > major(current)),
  }
}

// Deletes the rules whose package location belongs to a bumped tool. The comment heading a block
// sits on its first rule and goes with it
export function dropRules(text, locations) {
  const doc = parseDocument(text)
  const rules = doc.get('ignore')
  const before = rules.items.length
  const first = rules.items[0]
  rules.items = rules.items.filter((rule) => {
    const location = String(rule.getIn(['package', 'location']) ?? '')
    return !locations.some(l => l.endsWith('/') ? location.startsWith(l) : location === l)
  })
  // The comment of the first block hangs on the list itself
  if (first && !rules.items.includes(first)) {
    rules.commentBefore = rules.items[0]?.commentBefore
    if (rules.items[0]) Object.assign(rules.items[0], { commentBefore: undefined, spaceBefore: false })
  }
  return { text: String(doc), removed: before - rules.items.length }
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': 'security-scanner-tools-update', ...headers } })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

async function releases(tool) {
  if (tool.github) {
    const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
    const list = await getJson(`https://api.github.com/repos/${tool.github}/releases?per_page=50`, auth)
    return list.filter(r => !r.draft && !r.prerelease)
      .map(r => ({ version: r.tag_name.replace(/^v/, ''), published: r.published_at }))
  }
  if (tool.npm) {
    const doc = await getJson(`https://registry.npmjs.org/${tool.npm}`)
    return Object.keys(doc.versions)
      .filter(v => !doc.versions[v].deprecated)
      .map(v => ({ version: v, published: doc.time[v] }))
  }
  const doc = await getJson(`https://pypi.org/pypi/${tool.pypi}/json`)
  return Object.entries(doc.releases)
    .filter(([, files]) => files.length && files.every(f => !f.yanked))
    .map(([version, files]) => ({ version, published: files[0].upload_time_iso_8601 }))
}

// The new cosign binary, verified by the pinned one against the Sigstore signature of the release
async function cosignHash(version, pinned) {
  const dir = mkdtempSync(join(tmpdir(), 'cosign-'))
  try {
    const base = `https://github.com/sigstore/cosign/releases/download/v${version}`
    for (const file of ['cosign-linux-amd64', 'cosign-linux-amd64.sigstore.json']) {
      const res = await fetch(`${base}/${file}`)
      if (!res.ok) throw new Error(`${base}/${file}: ${res.status}`)
      writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()))
    }
    execFileSync(pinned, [
      'verify-blob', '--bundle', join(dir, 'cosign-linux-amd64.sigstore.json'),
      '--certificate-identity', 'keyless@projectsigstore.iam.gserviceaccount.com',
      '--certificate-oidc-issuer', 'https://accounts.google.com',
      join(dir, 'cosign-linux-amd64'),
    ], { stdio: 'inherit' })
    return createHash('sha256').update(readFileSync(join(dir, 'cosign-linux-amd64'))).digest('hex')
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(summaryPath) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const envPath = join(root, 'scripts/tools.env')
  const grypePath = join(root, '.grype.yaml')
  let env = readFileSync(envPath, 'utf8')
  const current = readEnv(env)
  const bumped = []
  const majors = []
  for (const tool of TOOLS) {
    const { next, major: newer } = pickRelease(await releases(tool), current[tool.key])
    if (newer) majors.push(`${tool.name} ${newer.version}`)
    if (!next) continue
    if (tool.name === 'cosign') {
      if (!process.env.COSIGN) throw new Error('COSIGN must point to the pinned cosign binary')
      env = writeEnv(env, 'COSIGN_SHA256', await cosignHash(next.version, process.env.COSIGN))
    }
    env = writeEnv(env, tool.key, next.version)
    bumped.push({ tool, from: current[tool.key], to: next.version, published: next.published.slice(0, 10) })
  }

  const lines = []
  if (bumped.length) {
    writeFileSync(envPath, env)
    const grype = dropRules(readFileSync(grypePath, 'utf8'), bumped.map(b => b.tool.location))
    if (grype.removed) writeFileSync(grypePath, grype.text)
    lines.push(
      `Scanner versions in \`scripts/tools.env\`, released at least ${COOLDOWN_DAYS} days ago.`,
      '',
      '| Tool | From | To | Released |',
      '|---|---|---|---|',
      ...bumped.map(b => `| ${b.tool.name} | ${b.from} | ${b.to} | ${b.published} |`),
      '',
      grype.removed
        ? `${grype.removed} rules of the bumped tools removed from \`.grype.yaml\`. If the Grype gate fails, add back the CVEs still unfixed upstream, scoped to the new version.`
        : 'No `.grype.yaml` rule concerned the bumped tools.',
    )
    if (bumped.some(b => b.tool.name === 'cosign')) {
      lines.push('', 'Cosign: the pinned binary verified the Sigstore signature of the new one before its hash was pinned.')
    }
  }
  if (majors.length) {
    lines.push('', `New majors, left for a manual review: ${majors.join(', ')}.`)
  }
  writeFileSync(summaryPath, `${lines.join('\n')}\n`)
  console.log(bumped.length ? bumped.map(b => `${b.tool.name} ${b.from} → ${b.to}`).join('\n') : 'Every tool is current')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Usage: node scripts/update-tools.mjs <summary.md>')
    process.exit(1)
  }
  await main(process.argv[2])
}
