import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200) })

// Squash merge, only when everything is green. Same conditions as the screen, checked again here
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  const ref = validRef((await readValidatedBody(event, Body.parse)).ref)
  const pr = await pullForBranch(t, ref)
  if (!pr) throw createError({ statusCode: 409, message: 'No open pull request: approve first' })
  if (pr.draft) throw createError({ statusCode: 409, message: 'Pull request is a draft' })

  const branchScan = latestScan(t.id, ref)
  if (!branchScan || branchScan.sha !== pr.head.sha) {
    throw createError({ statusCode: 409, message: 'The latest commit of the branch has not been scanned' })
  }
  const checks = await checksFor(t.repo, pr.head.sha)
  if (checks.state !== 'success' && checks.state !== 'none') {
    const reason = { pending: 'pending', failure: 'failing', unavailable: 'unreadable' }[checks.state] ?? checks.state
    throw createError({ statusCode: 409, message: `Checks ${reason}${checks.warning ? `: ${checks.warning}` : ''}` })
  }

  // The preview must be built on the current base: otherwise production is not what was tested
  const base = await defaultBranch(t.repo)
  const compare = await githubApi<{ behind_by: number }>(`/repos/${t.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(ref)}`)
  if (compare.behind_by) throw createError({ statusCode: 409, message: `${compare.behind_by} commit(s) behind ${base}: update the branch` })

  // sha: GitHub refuses the merge if a commit landed in the meantime
  const merged = await githubApi<{ sha: string }>(`/repos/${t.repo}/pulls/${pr.number}/merge`, {
    method: 'PUT',
    body: { merge_method: 'squash', sha: pr.head.sha },
  })
  // The branch goes away, unless it is protected
  await githubApi(`/repos/${t.repo}/git/refs/heads/${ref}`, { method: 'DELETE' }).catch(() => {})
  // Production changed: new scan of the default branch
  const { scanId } = enqueueScan(t.id, 'manual')
  // The merge is only done once production is live
  watchDeploy(t, merged.sha, ref)
  return { merged: true, scanId }
})
