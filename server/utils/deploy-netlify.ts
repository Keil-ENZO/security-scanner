import { useRuntimeConfig } from '#imports'
import { fetchJson } from './github'
import type { Deployment, DeployProvider } from './providers'

// Netlify reports through commit statuses (netlify/<site>/deploy-preview, deploy/netlify)
// or check runs from its GitHub App. Headers go in netlify.toml

// Deploy pages, under /sites/ or /projects/ since the rename. Ids are 24 hex characters
const DEPLOY_URL = /^https:\/\/app\.netlify\.com\/(?:sites|projects)\/[\w.-]+\/deploys\/([a-f0-9]{24})(?:[/?#]|$)/

export function netlifyDeployId(url: string | null) {
  return url?.match(DEPLOY_URL)?.[1] ?? null
}

// TOML lines read here. Multi-line strings are not parsed: netlify.toml rarely has any
const TABLE = /^\s*\[/
const HEADERS_BLOCK = /^\s*\[\[\s*headers\s*\]\]\s*(?:#.*)?$/
const VALUES_TABLE = /^\s*\[\s*headers\s*\.\s*values\s*\]\s*(?:#.*)?$/
const FOR_ALL = /^\s*for\s*=\s*(["'])\/\*\1\s*(?:#.*)?$/
const INLINE_VALUES = /^\s*values\s*=\s*\{(.*)\}/
const KEY = /^\s*(["']?)([\w-]+)\1\s*=/

const tomlKey = (k: string) => /^[\w-]+$/.test(k) ? k : JSON.stringify(k)
const tomlString = (v: string) => JSON.stringify(v)

interface Block { start: number, end: number, values: [number, number] | null, inline: string | null }

// [[headers]] blocks with for = "/*". end is exclusive. values: the [headers.values] lines
function catchAllBlocks(lines: string[]) {
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!HEADERS_BLOCK.test(lines[i]!)) continue
    let end = i + 1
    let values: [number, number] | null = null
    let inline: string | null = null
    let all = false
    while (end < lines.length) {
      const line = lines[end]!
      if (VALUES_TABLE.test(line)) values = [end, end + 1]
      else if (TABLE.test(line)) break
      else if (values) values[1] = end + 1
      else if (FOR_ALL.test(line)) all = true
      else inline = line.match(INLINE_VALUES)?.[1] ?? inline
      end++
    }
    if (all) blocks.push({ start: i, end, values, inline })
    i = end - 1
  }
  return blocks
}

function writeHeaders(content: string | undefined, headers: Record<string, string>) {
  const eol = content?.includes('\r\n') ? '\r\n' : '\n'
  const lines = content ? content.split(/\r?\n/) : []
  const blocks = catchAllBlocks(lines)

  const present = new Set<string>()
  for (const b of blocks) {
    if (b.values) for (const l of lines.slice(b.values[0] + 1, b.values[1])) present.add(l.match(KEY)?.[2]?.toLowerCase() ?? '')
    for (const m of b.inline?.matchAll(/(?:^|,)\s*(["']?)([\w-]+)\1\s*=/g) ?? []) present.add(m[2]!.toLowerCase())
  }
  const added = Object.keys(headers).filter(h => !present.has(h.toLowerCase()))
  if (!added.length) return { content: content ?? '', added }

  const entries = (indent: string) => added.map(k => `${indent}${tomlKey(k)} = ${tomlString(headers[k]!)}`)
  const target = blocks.find(b => b.values) ?? blocks.find(b => !b.inline)

  if (target?.values) {
    // After the last key of the table, before trailing blanks and comments
    const [from, to] = target.values
    let at = to
    while (at > from + 1 && !KEY.test(lines[at - 1]!)) at--
    const last = at > from + 1 ? lines[at - 1]! : null
    const indent = last ? last.match(/^\s*/)![0] : `${lines[from]!.match(/^\s*/)![0]}  `
    lines.splice(at, 0, ...entries(indent))
  }
  else if (target) {
    let at = target.end
    while (at > target.start + 1 && !lines[at - 1]!.trim()) at--
    const indent = lines[target.start]!.match(/^\s*/)![0]
    lines.splice(at, 0, `${indent}  [headers.values]`, ...entries(`${indent}    `))
  }
  else {
    // A new block, after a blank line. The last line is empty when the file ends with a newline
    if (!lines.some(l => l.trim())) lines.length = 0
    else if (lines.at(-1) !== '') lines.push('')
    lines.push('[[headers]]', '  for = "/*"', '  [headers.values]', ...entries('    '), '')
  }
  return { content: lines.join(eol), added }
}

export const netlifyProvider: DeployProvider = {
  label: 'Netlify',
  headersFile: 'netlify.toml',

  // The item linking to a deploy page first: Netlify also posts header and redirect summaries
  async deployment(_repo, _sha, checks) {
    const items = checks.items.filter(i => /netlify/i.test(i.name))
    return items.find(i => netlifyDeployId(i.url)) ?? items[0] ?? null
  },

  // Needs NUXT_NETLIFY_TOKEN. The API has no build log endpoint: error and deploy summary instead
  async logs(d: Deployment) {
    const token = useRuntimeConfig().netlifyToken
    if (!token) return null
    const id = netlifyDeployId(d.url)
    if (!id) return null
    const deploy = await fetchJson<{
      error_message?: string | null
      summary?: { messages?: { type?: string, title?: string, description?: string, details?: string | null }[] } | null
    }>(`https://api.netlify.com/api/v1/deploys/${id}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'security-scanner' },
    })
    const lines = [
      deploy.error_message,
      ...(deploy.summary?.messages ?? []).map(m => [m.title, m.description, m.details].filter(Boolean).join(': ')),
    ].filter(Boolean)
    return lines.length ? lines.join('\n') : null
  },

  writeHeaders,
}
