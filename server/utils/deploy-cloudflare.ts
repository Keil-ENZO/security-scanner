import { useRuntimeConfig } from '#imports'
import { fetchJson, githubApi } from './github'
import type { Deployment, DeployProvider } from './providers'

// Cloudflare Pages. Its GitHub app reports each build as a check run named "Cloudflare Pages",
// one per project in a monorepo. The check page on GitHub is all checksFor keeps: the preview URL
// and the dashboard link, which holds the project and deployment id, only sit in the run output

// Project and deployment id, read from the run output, for the build log
export type CloudflareDeployment = Deployment & { project?: string, deploymentId?: string }

// Project names: lowercase letters, digits and dashes, 58 characters at most
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,57}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ACCOUNT_RE = /^[0-9a-f]{32}$/
// "View logs" link: https://dash.cloudflare.com/?to=/:account/pages/view/<project>/<deployment id>
const DASH_RE = /dash\.cloudflare\.com\/\?to=\/(?::account|[0-9a-f]{32})\/pages\/view\/([^/\s"'<>)]+)\/([^/\s"'<>)?#]+)/
const PREVIEW_RE = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pages\.dev\b/i

// Project and deployment id from a dashboard link, null unless both are well formed
export function cloudflareIds(text: string | null | undefined) {
  const m = text?.match(DASH_RE)
  if (!m || !PROJECT_RE.test(m[1]!) || !UUID_RE.test(m[2]!)) return null
  return { project: m[1]!, deploymentId: m[2]! }
}

interface CheckRun { name: string, details_url: string | null, output: { summary: string | null, text: string | null } }

// Fills the preview URL and the ids from the run output. Pure, for the tests
export function fromCheckRun(d: Deployment, run: CheckRun): CloudflareDeployment {
  const text = [run.details_url, run.output?.summary, run.output?.text].filter(Boolean).join('\n')
  const preview = text.match(PREVIEW_RE)?.[0]
  return { ...d, url: preview ?? d.url, ...cloudflareIds(text) }
}

export const cloudflareProvider: DeployProvider = {
  label: 'Cloudflare Pages',
  // Pages serves _headers from the build output directory. Nuxt, Vite, Next, Astro and Remix copy
  // public/ there as is. SvelteKit, Gatsby and Hugo use static/: not covered, the file is ignored
  headersFile: 'public/_headers',

  // One more GitHub call to read the run output, once the build is over: the preview URL goes in
  // the notification, the ids give the log. Skipped while pending, which is most watchDeploy ticks
  async deployment(repo, sha, checks) {
    const d = checks.items.find(i => /cloudflare/i.test(i.name))
    if (!d) return null
    // A commit status links to the dashboard directly
    const ids = cloudflareIds(d.url) ?? cloudflareIds(d.description)
    if (ids) return { ...d, ...ids }
    if (d.state === 'pending') return d
    const runs = await githubApi<{ check_runs: CheckRun[] }>(`/repos/${repo}/commits/${sha}/check-runs`, { query: { check_name: d.name } })
      .catch(() => null)
    const run = runs?.check_runs.find(r => r.name === d.name)
    return run ? fromCheckRun(d, run) : d
  },

  // Needs NUXT_CLOUDFLARE_TOKEN (Pages read) and NUXT_CLOUDFLARE_ACCOUNT_ID
  async logs(d: CloudflareDeployment) {
    const { cloudflareToken: token, cloudflareAccountId: account } = useRuntimeConfig()
    const { project, deploymentId } = d
    if (!token || !account || !project || !deploymentId) return null
    // Every segment checked again: they come from text written by a third party
    if (!ACCOUNT_RE.test(account) || !PROJECT_RE.test(project) || !UUID_RE.test(deploymentId)) return null
    const res = await fetchJson<{ result: { data: { line: string }[] } }>(
      `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments/${deploymentId}/history/logs`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    return res.result.data.slice(-80).map(l => l.line).join('\n')
  },

  writeHeaders(content, headers) {
    const eol = content?.includes('\r\n') ? '\r\n' : '\n'
    const lines = content ? content.split(/\r?\n/) : []
    // A rule: a path line, then indented "Name: value" or "! Name" lines
    const start = lines.findIndex(l => l.trimEnd() === '/*')
    let end = start + 1
    let indent = '  '
    const present = new Set<string>()
    if (start >= 0) {
      for (let i = start + 1; i < lines.length && (/^\s/.test(lines[i]!) || !lines[i]!.trim()); i++) {
        const line = lines[i]!
        const name = line.trim().replace(/^!\s*/, '').split(':')[0]!.trim()
        if (!name || name.startsWith('#')) continue
        // A detached header stays detached
        present.add(name.toLowerCase())
        indent = line.match(/^\s+/)![0]
        end = i + 1
      }
    }
    const added = Object.keys(headers).filter(h => !present.has(h.toLowerCase()))
    if (!added.length) return { content: content ?? '', added }
    const block = added.map(h => `${indent}${h}: ${headers[h]}`)
    if (start >= 0) {
      lines.splice(end, 0, ...block)
    }
    else {
      // Appended after the existing rules, a blank line apart
      while (lines.length && !lines.at(-1)!.trim()) lines.pop()
      lines.push(...(lines.length ? [''] : []), '/*', ...block, '')
    }
    if (lines.at(-1) !== '') lines.push('')
    return { content: lines.join(eol), added }
  },
}
