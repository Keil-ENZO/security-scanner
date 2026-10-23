// Tout ce qu'il faut pour décider : diff, commits, checks, et comparaison des scans
interface CompareFile { filename: string, status: string, additions: number, deletions: number, patch?: string }
interface CompareCommit { sha: string, commit: { message: string, author: { name: string, date: string } } }

const key = (f: { tool: string, rule_id: string | null, title: string }) => `${f.tool}|${f.rule_id}|${f.title}`

export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef(String(getQuery(event).ref ?? ''))
  const base = await defaultBranch(t.repo)
  if (ref === base) throw createError({ statusCode: 400, message: 'La branche par défaut n’a rien à comparer' })

  const [compare, pr, branch] = await Promise.all([
    githubApi<{ ahead_by: number, behind_by: number, commits: CompareCommit[], files: CompareFile[] }>(
      `/repos/${t.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(ref)}`),
    pullForBranch(t, ref),
    githubApi<{ commit: { sha: string } }>(`/repos/${t.repo}/branches/${encodeURIComponent(ref)}`),
  ])
  // Le sha de la branche elle-même : une branche sans commit d'avance n'en a aucun dans le diff
  const headSha = branch.commit.sha
  const [checks, merge] = await Promise.all([
    checksFor(t.repo, headSha),
    pr ? pullMergeState(t.repo, pr.number).catch(() => null) : null,
  ])
  // Preview rouge : la raison est dans le log de build, pas dans GitHub
  const vercel = checks.items.find(i => /vercel/i.test(i.name) && i.state === 'failure')
  const previewLogs = vercel ? await vercelLogs(vercel.description, vercel.url).catch(() => null) : null

  // Comparaison des findings de code : le site ne se scanne qu'en prod
  const db = useDb()
  const baseScan = latestScan(t.id, null)
  const branchScan = latestScan(t.id, ref)
  const running = db.prepare(`SELECT id FROM scans WHERE target_id = ? AND ref IS ? AND status IN ('queued', 'running')`).get(t.id, ref) as { id: number } | undefined
  const codeFindings = db.prepare(`SELECT tool, severity, title, rule_id, location FROM findings WHERE scan_id = ? AND tool != 'nuclei'`)
  let diff = null
  if (baseScan && branchScan) {
    const before = codeFindings.all(baseScan.id) as { tool: string, severity: string, title: string, rule_id: string | null, location: string | null }[]
    const after = codeFindings.all(branchScan.id) as typeof before
    const afterKeys = new Set(after.map(key))
    const beforeKeys = new Set(before.map(key))
    diff = {
      resolved: before.filter(f => !afterKeys.has(key(f))),
      introduced: after.filter(f => !beforeKeys.has(key(f))),
      remaining: after.filter(f => beforeKeys.has(key(f))).length,
    }
  }

  const fix = db.prepare('SELECT id, summary FROM fixes WHERE branch = ? ORDER BY id DESC LIMIT 1').get(ref) as { id: number, summary: string | null } | undefined
  const scanUpToDate = !!branchScan && branchScan.sha === headSha

  return {
    target: { id: t.id, name: t.name, repo: t.repo },
    base,
    ref,
    headSha,
    aheadBy: compare.ahead_by,
    behindBy: compare.behind_by,
    commits: compare.commits.map(c => ({ sha: c.sha, message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date })),
    files: compare.files.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })),
    checks,
    previewLogs,
    // false : conflits avec la base. null : GitHub calcule encore
    conflicts: merge?.mergeable === false || merge?.state === 'dirty',
    pr: pr ? { number: pr.number, url: pr.html_url, draft: pr.draft } : null,
    scans: { base: baseScan ?? null, branch: branchScan ?? null, runningId: running?.id ?? null, upToDate: scanUpToDate },
    diff,
    fix: fix ?? null,
    canMerge: compare.ahead_by > 0 && !compare.behind_by && !!pr && !pr.draft && scanUpToDate && (checks.state === 'success' || checks.state === 'none') && !(diff?.introduced.length),
  }
})
