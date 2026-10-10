import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200) })

// Validation : ouvre la pull request de la branche
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef((await readValidatedBody(event, Body.parse)).ref)
  const base = await defaultBranch(t.repo)
  if (ref === base) throw createError({ statusCode: 400, message: 'Pas de PR depuis la branche par défaut' })
  const existing = await pullForBranch(t, ref)
  if (existing) return { number: existing.number, url: existing.html_url }

  const fix = useDb().prepare('SELECT scan_id, pr_body FROM fixes WHERE branch = ? ORDER BY id DESC LIMIT 1').get(ref) as { scan_id: number, pr_body: string | null } | undefined
  const pr = await githubApi<{ number: number, html_url: string }>(`/repos/${t.repo}/pulls`, {
    method: 'POST',
    body: {
      title: fix ? `Sécurité : corrections du scan #${fix.scan_id}` : `Sécurité : ${ref}`,
      head: ref,
      base,
      body: fix?.pr_body ?? 'Validée dans le Security Scanner après un scan de la branche.',
    },
  })
  return { number: pr.number, url: pr.html_url }
})
