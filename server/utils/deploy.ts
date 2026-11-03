// Production deployment: the latest commit on the default branch, as its provider deployed it
export async function productionDeploy(repo: string) {
  const provider = deployProvider()
  const base = await defaultBranch(repo)
  const head = await githubApi<{ sha: string, commit: { message: string, author: { date: string } } }>(`/repos/${repo}/commits/${encodeURIComponent(base)}`)
  const checks = await checksFor(repo, head.sha)
  const d = await provider.deployment(repo, head.sha, checks)
  const logs = d?.state === 'failure' ? await provider.logs(d).catch(() => null) : null
  return {
    base,
    sha: head.sha,
    message: head.commit.message.split('\n')[0],
    date: head.commit.author.date,
    state: d?.state ?? checks.state,
    url: d?.url ?? null,
    description: d?.description ?? null,
    logs,
  }
}

// After a merge, follow the deployment of the commit and send a notification.
// Outside the queue: a few GitHub calls every 20 s, for 20 min at most
export function watchDeploy(t: TargetRepo, sha: string, ref: string) {
  const provider = deployProvider()
  const until = Date.now() + 20 * 60_000
  const link = `${useRuntimeConfig().publicUrl}/targets/${t.id}`
  const tick = async () => {
    const checks = await checksFor(t.repo, sha).catch(() => null)
    const d = checks ? await provider.deployment(t.repo, sha, checks).catch(() => null) : null
    if (d?.state === 'success') {
      await notify(`🟢 ${t.name}: ${ref} is live\n\n${d.url ?? link}`)
      return
    }
    if (d?.state === 'failure') {
      const logs = await provider.logs(d).catch(() => null)
      const tail = logs ? `\n\n${logs.split('\n').slice(-15).join('\n')}` : ''
      await notify(`🔴 ${t.name}: deployment failed after merging ${ref}. Production stays on the previous version.\n${d.description ?? ''}${tail}\n\n${link}`)
      return
    }
    if (Date.now() < until) setTimeout(tick, 20_000)
    else if (d) await notify(`⏳ ${t.name}: deployment still running after 20 min\n\n${link}`)
  }
  setTimeout(tick, 20_000)
}
