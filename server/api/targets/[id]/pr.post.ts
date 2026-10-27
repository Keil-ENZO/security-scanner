import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200) })

// Approval: opens the pull request of the branch
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef((await readValidatedBody(event, Body.parse)).ref)
  const base = await defaultBranch(t.repo)
  if (ref === base) throw createError({ statusCode: 400, message: 'No pull request from the default branch' })
  const existing = await pullForBranch(t, ref)
  if (existing) return { number: existing.number, url: existing.html_url }

  const fix = useDb().prepare('SELECT scan_id, pr_body FROM fixes WHERE branch = ? ORDER BY id DESC LIMIT 1').get(ref) as { scan_id: number, pr_body: string | null } | undefined
  const pr = await githubApi<{ number: number, html_url: string }>(`/repos/${t.repo}/pulls`, {
    method: 'POST',
    body: {
      title: fix ? `Security: fixes from scan #${fix.scan_id}` : `Security: ${ref}`,
      head: ref,
      base,
      body: fix?.pr_body ?? 'Approved in Security Scanner after a scan of the branch.',
    },
  })
  return { number: pr.number, url: pr.html_url }
})
