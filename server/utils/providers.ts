import { genericProvider } from './deploy-generic'
import { type CheckItem, type Checks, fetchJson } from './github'

// Where a target deploys. A provider finds the deployment of a commit among its GitHub checks,
// reads its build log, and writes security headers in its own config file

export type Deployment = CheckItem

export interface DeployProvider {
  // Shown in the UI and notifications
  label: string
  // Deployment of a commit, from the checks GitHub returned for it
  deployment: (repo: string, sha: string, checks: Checks) => Promise<Deployment | null>
  // Tail of the build log, null without a token. Read only
  logs: (d: Deployment) => Promise<string | null>
  // Config file holding the headers, at the root of the repository. null: no known file, headers stay manual
  headersFile: string | null
  // Adds the missing headers to the file content, undefined when the file does not exist. No I/O
  writeHeaders?: (content: string | undefined, headers: Record<string, string>) => { content: string, added: string[] }
}

const vercel = {
  label: 'Vercel',
  headersFile: 'vercel.json',

  async deployment(_repo, _sha, checks) {
    return checks.items.find(i => /vercel/i.test(i.name)) ?? null
  },

  // Needs NUXT_VERCEL_TOKEN
  async logs(d) {
    const token = useRuntimeConfig().vercelToken
    if (!token) return null
    // "npx vercel inspect dpl_…" in the description, else the last URL segment
    const fromUrl = d.url?.match(/\/([A-Za-z0-9]{20,})$/)?.[1]
    const id = d.description?.match(/dpl_[A-Za-z0-9]+/)?.[0] ?? (fromUrl ? `dpl_${fromUrl}` : null)
    if (!id) return null
    const events = await fetchJson<{ type: string, text?: string }[]>(`https://api.vercel.com/v3/deployments/${id}/events`, {
      query: { builds: 1, direction: 'backward', limit: 80 },
      headers: { Authorization: `Bearer ${token}` },
    })
    return events.filter(e => e.text && ['stdout', 'stderr', 'command'].includes(e.type)).map(e => e.text!).reverse().join('\n')
  },

  writeHeaders(content, headers) {
    const config = content ? JSON.parse(content) : { $schema: 'https://openapi.vercel.sh/vercel.json' }
    config.headers ??= []
    let rule = config.headers.find((h: any) => h.source === '/(.*)')
    if (!rule) {
      rule = { source: '/(.*)', headers: [] }
      config.headers.push(rule)
    }
    const present = new Set(rule.headers.map((h: any) => String(h.key).toLowerCase()))
    const added = Object.keys(headers).filter(h => !present.has(h))
    for (const key of added) rule.headers.push({ key, value: headers[key]! })
    return { content: `${JSON.stringify(config, null, 2)}\n`, added }
  },
} satisfies DeployProvider

export const providers = {
  vercel,
  generic: genericProvider,
} satisfies Record<string, DeployProvider>

// Vercel until targets store their provider
export function deployProvider(): DeployProvider {
  return providers.vercel
}
