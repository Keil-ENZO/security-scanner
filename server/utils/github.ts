// API GitHub, avec le jeton du scanner. Le dépôt est toujours revérifié contre l'allowlist

const REF_RE = /^[A-Za-z0-9._/-]{1,200}$/

export function validRef(ref: string) {
  if (!REF_RE.test(ref) || ref.includes('..') || ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/')) {
    throw createError({ statusCode: 400, message: 'Nom de branche invalide' })
  }
  return ref
}

// $fetch non typé par les routes de Nitro : sinon l'inférence tourne en rond.
// Lu à l'appel : au chargement du module, Nitro ne l'a pas encore défini
const fetchJson = <T>(url: string, opts: object) => ($fetch as unknown as (u: string, o: object) => Promise<T>)(url, opts)

export async function githubApi<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: object, query?: Record<string, string | number> } = {}): Promise<T> {
  const token = useRuntimeConfig().githubToken
  if (!token) throw createError({ statusCode: 400, message: 'NUXT_GITHUB_TOKEN requis' })
  try {
    return await fetchJson<T>(`https://api.github.com${path}`, {
      method: opts.method ?? 'GET',
      body: opts.body,
      query: opts.query,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'security-scanner',
      },
    })
  }
  catch (err: any) {
    // Le chemin dit quelle permission du jeton manque
    const route = path.replace(/^\/repos\/[^/]+\/[^/]+/, '').split('?')[0] || '/'
    const hint = PERMISSION_HINT.find(([re]) => re.test(route))?.[1]
    const status = err?.response?.status ?? err?.statusCode
    const detail = err?.data?.message ?? err?.message ?? 'erreur'
    throw createError({
      statusCode: 502,
      message: `GitHub ${opts.method ?? 'GET'} ${route} : ${detail}${status === 403 && hint ? `. Permission du jeton à ajouter : ${hint}` : ''}`,
    })
  }
}

const PERMISSION_HINT: [RegExp, string][] = [
  [/^\/commits\/[^/]+\/status/, 'Commit statuses, lecture'],
  [/^\/commits\/[^/]+\/check-runs/, 'Checks, lecture'],
  [/^\/pulls\/\d+\/merge/, 'Contents et Pull requests, écriture'],
  [/^\/pulls/, 'Pull requests, lecture et écriture'],
  [/^\/git\/refs/, 'Contents, écriture'],
  [/^\/merges/, 'Contents, écriture'],
  [/^\/(compare|branches)/, 'Contents, lecture'],
]

export interface TargetRepo { id: number, name: string, repo: string, owner: string }

export function targetRepo(id: number): TargetRepo {
  const t = useDb().prepare('SELECT id, name, repo FROM targets WHERE id = ?').get(id) as { id: number, name: string, repo: string | null } | undefined
  if (!t) throw createError({ statusCode: 404, message: 'Cible inconnue' })
  if (!t.repo) throw createError({ statusCode: 400, message: 'Cette cible n’a pas de dépôt' })
  const repo = parseRepo(`https://github.com/${t.repo}`)
  return { id: t.id, name: t.name, repo, owner: repo.split('/')[0]! }
}

export async function defaultBranch(repo: string) {
  return (await githubApi<{ default_branch: string }>(`/repos/${repo}`)).default_branch
}

export interface PullRequest { number: number, html_url: string, title: string, head: { ref: string, sha: string }, draft: boolean }

export async function openPulls(repo: string): Promise<PullRequest[]> {
  return githubApi<PullRequest[]>(`/repos/${repo}/pulls`, { query: { state: 'open', per_page: 100 } })
}

export async function pullForBranch(t: TargetRepo, ref: string) {
  const pulls = await githubApi<PullRequest[]>(`/repos/${t.repo}/pulls`, { query: { state: 'open', head: `${t.owner}:${ref}` } })
  return pulls[0] ?? null
}

// Statut de la preview Vercel et des checks d'un commit : failure > pending > success > none
export interface Checks { state: string, preview: string | null, warning: string | null, items: { name: string, state: string, url: string | null, description: string | null }[] }

export async function checksFor(repo: string, sha: string): Promise<Checks> {
  let warning: string | null = null
  const [status, runs] = await Promise.all([
    githubApi<{ state: string, total_count: number, statuses: { context: string, state: string, target_url: string | null, description: string | null }[] }>(`/repos/${repo}/commits/${sha}/status`)
      .catch((err) => {
        warning = err.message
        return { state: 'unknown', total_count: 0, statuses: [] }
      }),
    githubApi<{ check_runs: { name: string, status: string, conclusion: string | null, html_url: string }[] }>(`/repos/${repo}/commits/${sha}/check-runs`).catch(() => ({ check_runs: [] })),
  ])
  const items = [
    ...status.statuses.map(s => ({ name: s.context, state: s.state === 'error' ? 'failure' : s.state, url: s.target_url, description: s.description })),
    ...runs.check_runs.map(r => ({
      name: r.name,
      state: r.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(r.conclusion ?? '') ? 'success' : 'failure',
      url: r.html_url,
      description: r.conclusion,
    })),
  ]
  // Sans les statuts, on ne sait pas si la preview est verte : c'est bloquant
  if (warning) return { state: 'unavailable', preview: null, items, warning }
  const state = items.some(i => i.state === 'failure') ? 'failure'
    : items.some(i => i.state === 'pending') ? 'pending'
      : items.length ? 'success' : 'none'
  const preview = status.statuses.find(s => /vercel/i.test(s.context) && s.state === 'success')?.target_url ?? null
  return { state, preview, items, warning: null }
}

// Dernier scan terminé d'une branche, NULL pour la branche par défaut
export function latestScan(targetId: number, ref: string | null) {
  return useDb().prepare(`
    SELECT id, sha, created_at FROM scans WHERE target_id = ? AND status = 'done' AND ref IS ? ORDER BY id DESC LIMIT 1
  `).get(targetId, ref) as { id: number, sha: string | null, created_at: string } | undefined
}

// mergeable vaut null tant que GitHub calcule. dirty : conflits. behind : en retard sur la base
export async function pullMergeState(repo: string, number: number) {
  const pr = await githubApi<{ mergeable: boolean | null, mergeable_state: string }>(`/repos/${repo}/pulls/${number}`)
  return { mergeable: pr.mergeable, state: pr.mergeable_state }
}

// Merge de la base dans la branche, côté GitHub. 409 : conflits, à résoudre autrement
export async function updateBranch(repo: string, ref: string, base: string) {
  try {
    const res = await githubApi<{ sha: string } | undefined>(`/repos/${repo}/merges`, {
      method: 'POST',
      body: { base: ref, head: base, commit_message: `Merge ${base} dans ${ref}` },
    })
    // 204 : déjà à jour
    return { conflict: false, sha: res?.sha ?? null }
  }
  catch (err: any) {
    if (/conflict/i.test(err?.message ?? '')) return { conflict: true, sha: null }
    throw err
  }
}

// Déploiement de production : le statut Vercel du dernier commit de la branche par défaut
export async function productionDeploy(repo: string) {
  const base = await defaultBranch(repo)
  const head = await githubApi<{ sha: string, commit: { message: string, author: { date: string } } }>(`/repos/${repo}/commits/${encodeURIComponent(base)}`)
  const checks = await checksFor(repo, head.sha)
  const vercel = checks.items.find(i => /vercel/i.test(i.name)) ?? null
  const logs = vercel?.state === 'failure' ? await vercelLogs(vercel.description, vercel.url).catch(() => null) : null
  return {
    base,
    sha: head.sha,
    message: head.commit.message.split('\n')[0],
    date: head.commit.author.date,
    state: vercel?.state ?? checks.state,
    url: vercel?.url ?? null,
    description: vercel?.description ?? null,
    logs,
  }
}

// Fin du log de build Vercel, si NUXT_VERCEL_TOKEN est renseigné. Lecture seule
export async function vercelLogs(description: string | null, url: string | null) {
  const token = useRuntimeConfig().vercelToken
  if (!token) return null
  // « npx vercel inspect dpl_… » dans la description, sinon le dernier segment de l'URL
  const fromUrl = url?.match(/\/([A-Za-z0-9]{20,})$/)?.[1]
  const id = description?.match(/dpl_[A-Za-z0-9]+/)?.[0] ?? (fromUrl ? `dpl_${fromUrl}` : null)
  if (!id) return null
  const events = await fetchJson<{ type: string, text?: string }[]>(`https://api.vercel.com/v3/deployments/${id}/events`, {
    query: { builds: 1, direction: 'backward', limit: 80 },
    headers: { Authorization: `Bearer ${token}` },
  })
  return events.filter(e => e.text && ['stdout', 'stderr', 'command'].includes(e.type)).map(e => e.text!).reverse().join('\n')
}
