// After a merge, follow the Vercel deployment of the commit and send a notification.
// Outside the queue: a few GitHub calls every 20 s, for 20 min at most
export function watchDeploy(t: TargetRepo, sha: string, ref: string) {
  const until = Date.now() + 20 * 60_000
  const link = `${useRuntimeConfig().publicUrl}/targets/${t.id}`
  const tick = async () => {
    const checks = await checksFor(t.repo, sha).catch(() => null)
    const vercel = checks?.items.find(i => /vercel/i.test(i.name))
    if (vercel?.state === 'success') {
      await notify(`🟢 ${t.name}: ${ref} is live\n\n${vercel.url ?? link}`)
      return
    }
    if (vercel?.state === 'failure') {
      const logs = await vercelLogs(vercel.description, vercel.url).catch(() => null)
      const tail = logs ? `\n\n${logs.split('\n').slice(-15).join('\n')}` : ''
      await notify(`🔴 ${t.name}: deployment failed after merging ${ref}. Production stays on the previous version.\n${vercel.description ?? ''}${tail}\n\n${link}`)
      return
    }
    if (Date.now() < until) setTimeout(tick, 20_000)
    else if (vercel) await notify(`⏳ ${t.name}: deployment still running after 20 min\n\n${link}`)
  }
  setTimeout(tick, 20_000)
}
