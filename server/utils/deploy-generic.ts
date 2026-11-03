import { githubApi } from './github'
import type { Deployment, DeployProvider } from './providers'

// Any host that reports to the GitHub Deployments API: Render, Railway, Fly, a CI job.
// No build log, no known config file for the headers

interface GithubDeployment { id: number, environment: string }
interface GithubDeploymentStatus { state: string, description: string | null, environment_url?: string | null, target_url?: string | null, log_url?: string | null }

// inactive: deployed, then replaced by a newer deployment to the same environment
const STATES: Record<string, string> = {
  success: 'success',
  inactive: 'success',
  failure: 'failure',
  error: 'failure',
}

export const genericProvider: DeployProvider = {
  label: 'GitHub Deployments',
  headersFile: null,

  // Latest deployment of the commit, newest first, then its latest status
  async deployment(repo, sha) {
    const [d] = await githubApi<GithubDeployment[]>(`/repos/${repo}/deployments`, { query: { sha, per_page: 1 } })
    if (!d) return null
    const [s] = await githubApi<GithubDeploymentStatus[]>(`/repos/${repo}/deployments/${d.id}/statuses`, { query: { per_page: 1 } })
    return {
      name: d.environment,
      // No status yet, queued, in_progress, pending
      state: (s && STATES[s.state]) ?? 'pending',
      url: s?.environment_url || s?.target_url || s?.log_url || null,
      description: s?.description || null,
    } satisfies Deployment
  },

  // GitHub keeps no build log
  async logs() {
    return null
  },
}
