// Après un merge, on suit le déploiement Vercel du commit et on prévient sur Telegram.
// Hors de la file : quelques appels GitHub toutes les 20 s, au plus 20 min
export function watchDeploy(t: TargetRepo, sha: string, ref: string) {
  const until = Date.now() + 20 * 60_000
  const link = `${useRuntimeConfig().publicUrl}/targets/${t.id}`
  const tick = async () => {
    const checks = await checksFor(t.repo, sha).catch(() => null)
    const vercel = checks?.items.find(i => /vercel/i.test(i.name))
    if (vercel?.state === 'success') {
      await notify(`🟢 ${t.name} : ${ref} est en ligne\n\n${vercel.url ?? link}`).catch(() => {})
      return
    }
    if (vercel?.state === 'failure') {
      const logs = await vercelLogs(vercel.description, vercel.url).catch(() => null)
      const tail = logs ? `\n\n${logs.split('\n').slice(-15).join('\n')}` : ''
      await notify(`🔴 ${t.name} : déploiement en échec après le merge de ${ref}. La prod reste sur la version précédente.\n${vercel.description ?? ''}${tail}\n\n${link}`).catch(() => {})
      return
    }
    if (Date.now() < until) setTimeout(tick, 20_000)
    else if (vercel) await notify(`⏳ ${t.name} : déploiement toujours en cours après 20 min\n\n${link}`).catch(() => {})
  }
  setTimeout(tick, 20_000)
}
