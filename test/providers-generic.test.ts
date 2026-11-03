import { beforeEach, describe, expect, it, vi } from 'vitest'
import { genericProvider } from '../server/utils/deploy-generic'
import { githubApi } from '../server/utils/github'
import { providers } from '../server/utils/providers'

vi.mock('../server/utils/github', async importOriginal => ({
  ...await importOriginal<typeof import('../server/utils/github')>(),
  githubApi: vi.fn(),
}))

const api = vi.mocked(githubApi)
const checks = { state: 'none', warning: null, items: [] }

// GitHub answers, by path
function answer(deployments: object[], statuses: object[] = []) {
  api.mockImplementation(async (path: string) => (path.endsWith('/statuses') ? statuses : deployments) as any)
}

describe('generic.deployment', () => {
  beforeEach(() => {
    api.mockReset()
  })

  it('is registered', () => {
    expect(providers.generic).toBe(genericProvider)
  })

  it('reads the latest status of the latest deployment of the commit', async () => {
    answer([{ id: 7, environment: 'production' }], [{
      state: 'success',
      description: 'Deploy live',
      environment_url: 'https://app.example.com',
      target_url: 'https://dashboard.example.com/deploys/1',
    }])
    const d = await genericProvider.deployment('o/r', 'abc', checks)
    expect(d).toEqual({ name: 'production', state: 'success', url: 'https://app.example.com', description: 'Deploy live' })
    expect(api).toHaveBeenNthCalledWith(1, '/repos/o/r/deployments', { query: { sha: 'abc', per_page: 1 } })
    expect(api).toHaveBeenNthCalledWith(2, '/repos/o/r/deployments/7/statuses', { query: { per_page: 1 } })
  })

  it.each([
    ['success', 'success'],
    ['inactive', 'success'],
    ['failure', 'failure'],
    ['error', 'failure'],
    ['queued', 'pending'],
    ['in_progress', 'pending'],
    ['pending', 'pending'],
  ])('maps %s to %s', async (state, expected) => {
    answer([{ id: 1, environment: 'preview' }], [{ state, description: null }])
    expect((await genericProvider.deployment('o/r', 'abc', checks))?.state).toBe(expected)
  })

  it('falls back on target_url then log_url', async () => {
    answer([{ id: 1, environment: 'preview' }], [{ state: 'failure', description: '', target_url: null, log_url: 'https://ci.example.com/42' }])
    expect(await genericProvider.deployment('o/r', 'abc', checks)).toMatchObject({ url: 'https://ci.example.com/42', description: null })
  })

  it('is pending while the deployment has no status', async () => {
    answer([{ id: 1, environment: 'preview' }])
    expect(await genericProvider.deployment('o/r', 'abc', checks)).toEqual({ name: 'preview', state: 'pending', url: null, description: null })
  })

  it('returns null without a deployment', async () => {
    answer([])
    expect(await genericProvider.deployment('o/r', 'abc', checks)).toBeNull()
    expect(api).toHaveBeenCalledTimes(1)
  })
})

describe('generic headers and logs', () => {
  it('has no config file and no log', async () => {
    expect(genericProvider.headersFile).toBeNull()
    expect(genericProvider.writeHeaders).toBeUndefined()
    expect(await genericProvider.logs({ name: 'production', state: 'failure', url: null, description: null })).toBeNull()
  })
})
