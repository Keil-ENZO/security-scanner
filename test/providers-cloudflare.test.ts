import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudflareIds, cloudflareProvider, fromCheckRun } from '../server/utils/deploy-cloudflare'
import { providers } from '../server/utils/providers'
import type { Checks } from '../server/utils/github'
import { runtimeConfig } from './stubs/imports'

const headers = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' }
const UUID = '4fcdd3b4-e0a7-42df-b2d9-4a89a1981d9d'
const DASH = `https://dash.cloudflare.com/?to=/:account/pages/view/portal/${UUID}`
// Output of a real Cloudflare Pages check run
const SUMMARY = `<table><tr><td><strong>Latest commit:</strong> </td><td>\n<code>be76cc6</code>\n</td></tr>
<tr><td><strong>Status:</strong></td><td>&nbsp;✅&nbsp; Deploy successful!</td></tr>
<tr><td><strong>Preview URL:</strong></td><td>\n<a href='https://4fcdd3b4.portal.pages.dev'>https://4fcdd3b4.portal.pages.dev</a>\n</td></tr>
</table>\n\n[View logs](${DASH})`

describe('cloudflare.writeHeaders', () => {
  const { writeHeaders } = cloudflareProvider

  it('is registered', () => {
    expect(providers.cloudflare).toBe(cloudflareProvider)
    expect(cloudflareProvider.headersFile).toBe('public/_headers')
  })

  it('creates a catch-all rule', () => {
    const edit = writeHeaders(undefined, headers)
    expect(edit.added).toEqual(['x-content-type-options', 'x-frame-options'])
    expect(edit.content).toBe('/*\n  x-content-type-options: nosniff\n  x-frame-options: SAMEORIGIN\n')
  })

  it('appends the rule after the other ones', () => {
    const edit = writeHeaders('/api/*\n  Cache-Control: no-store\n\n', headers)
    expect(edit.content).toBe('/api/*\n  Cache-Control: no-store\n\n/*\n  x-content-type-options: nosniff\n  x-frame-options: SAMEORIGIN\n')
  })

  it('extends the existing rule, keeps its indent and the rest of the file', () => {
    const current = '# Security\n/*\n    X-Frame-Options: DENY\n    # kept\n\n/api/*\n  Cache-Control: no-store'
    const edit = writeHeaders(current, headers)
    expect(edit.added).toEqual(['x-content-type-options'])
    expect(edit.content).toBe('# Security\n/*\n    X-Frame-Options: DENY\n    x-content-type-options: nosniff\n    # kept\n\n/api/*\n  Cache-Control: no-store\n')
  })

  it('leaves a detached header alone', () => {
    const edit = writeHeaders('/*\n  ! X-Frame-Options\n', headers)
    expect(edit.added).toEqual(['x-content-type-options'])
  })

  it('keeps CRLF line endings', () => {
    expect(writeHeaders('/*\r\n  X-Frame-Options: DENY\r\n', headers).content).toBe('/*\r\n  X-Frame-Options: DENY\r\n  x-content-type-options: nosniff\r\n')
  })

  it('adds nothing when every header is there', () => {
    const current = writeHeaders(undefined, headers).content
    expect(writeHeaders(current, headers)).toEqual({ content: current, added: [] })
  })
})

describe('cloudflare ids', () => {
  it('reads project and deployment id from the dashboard link', () => {
    expect(cloudflareIds(SUMMARY)).toEqual({ project: 'portal', deploymentId: UUID })
  })

  it('rejects anything that is not a plain name and a UUID', () => {
    expect(cloudflareIds(`https://dash.cloudflare.com/?to=/:account/pages/view/../${UUID}`)).toBeNull()
    expect(cloudflareIds('https://dash.cloudflare.com/?to=/:account/pages/view/portal/abc')).toBeNull()
    expect(cloudflareIds(`https://dash.cloudflare.com/?to=/:account/pages/view/Portal%2F/${UUID}`)).toBeNull()
    expect(cloudflareIds('https://github.com/o/r/runs/1')).toBeNull()
  })

  it('takes the preview URL from the run output', () => {
    const d = { name: 'Cloudflare Pages', state: 'success', url: 'https://github.com/o/r/runs/1', description: 'success' }
    expect(fromCheckRun(d, { name: d.name, details_url: DASH, output: { summary: SUMMARY, text: null } })).toEqual({
      ...d, url: 'https://4fcdd3b4.portal.pages.dev', project: 'portal', deploymentId: UUID,
    })
  })
})

describe('cloudflare.deployment', () => {
  const checks = (items: [string, string][]): Checks => ({
    state: 'success',
    warning: null,
    items: items.map(([name, state]) => ({ name, state, url: `https://github.com/o/r/runs/${name.length}`, description: null })),
  })
  const fetchMock = vi.fn()

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  function stubGithub() {
    vi.stubGlobal('useRuntimeConfig', () => ({ githubToken: 't' }))
    vi.stubGlobal('$fetch', fetchMock)
  }

  it('returns null when Cloudflare did not report', async () => {
    expect(await cloudflareProvider.deployment('o/r', 'sha', checks([['ci / test', 'success'], ['Vercel', 'success']]))).toBeNull()
  })

  it('does not call GitHub while the build runs', async () => {
    stubGithub()
    const d = await cloudflareProvider.deployment('o/r', 'sha', checks([['ci / test', 'success'], ['Cloudflare Pages', 'pending']]))
    expect(d).toMatchObject({ name: 'Cloudflare Pages', state: 'pending' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the run output once the build is over', async () => {
    stubGithub()
    fetchMock.mockResolvedValue({ check_runs: [{ name: 'Cloudflare Pages', details_url: DASH, output: { summary: SUMMARY, text: null } }] })
    const d = await cloudflareProvider.deployment('o/r', 'abc', checks([['Cloudflare Pages', 'success']]))
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/o/r/commits/abc/check-runs', expect.objectContaining({ query: { check_name: 'Cloudflare Pages' } }))
    expect(d).toMatchObject({ state: 'success', url: 'https://4fcdd3b4.portal.pages.dev', project: 'portal', deploymentId: UUID })
  })

  it('keeps the check when the output cannot be read', async () => {
    stubGithub()
    fetchMock.mockRejectedValue(new Error('403'))
    const d = await cloudflareProvider.deployment('o/r', 'abc', checks([['Cloudflare Pages', 'failure']]))
    expect(d).toMatchObject({ name: 'Cloudflare Pages', state: 'failure', url: 'https://github.com/o/r/runs/16' })
  })
})

describe('cloudflare.logs', () => {
  const d = { name: 'Cloudflare Pages', state: 'failure', url: null, description: null, project: 'portal', deploymentId: UUID }
  const account = '0123456789abcdef0123456789abcdef'
  const fetchMock = vi.fn()

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    Object.assign(runtimeConfig, { cloudflareToken: '', cloudflareAccountId: '' })
  })

  it('returns null without credentials or ids', async () => {
    vi.stubGlobal('$fetch', fetchMock)
    expect(await cloudflareProvider.logs(d)).toBeNull()
    Object.assign(runtimeConfig, { cloudflareToken: 't', cloudflareAccountId: account })
    expect(await cloudflareProvider.logs({ ...d, deploymentId: undefined })).toBeNull()
    expect(await cloudflareProvider.logs({ ...d, project: '../x' })).toBeNull()
    Object.assign(runtimeConfig, { cloudflareAccountId: 'acc/../x' })
    expect(await cloudflareProvider.logs(d)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the deployment log', async () => {
    Object.assign(runtimeConfig, { cloudflareToken: 't', cloudflareAccountId: account })
    vi.stubGlobal('$fetch', fetchMock)
    fetchMock.mockResolvedValue({ result: { data: [{ ts: '1', line: 'Cloning' }, { ts: '2', line: 'Build failed' }] } })
    expect(await cloudflareProvider.logs(d)).toBe('Cloning\nBuild failed')
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/portal/deployments/${UUID}/history/logs`,
      { headers: { Authorization: 'Bearer t' } },
    )
  })
})
