import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { deployProvider, isProviderId, logsHint, providers } from '../server/utils/providers'
import type { Checks } from '../server/utils/github'
import { runtimeConfig } from './stubs/imports'

const headers = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' }

describe('vercel.writeHeaders', () => {
  const { writeHeaders } = providers.vercel

  it('creates vercel.json with a catch-all rule', () => {
    const edit = writeHeaders(undefined, headers)
    expect(edit.added).toEqual(['x-content-type-options', 'x-frame-options'])
    expect(JSON.parse(edit.content)).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      headers: [{ source: '/(.*)', headers: [{ key: 'x-content-type-options', value: 'nosniff' }, { key: 'x-frame-options', value: 'SAMEORIGIN' }] }],
    })
  })

  it('keeps the rest of the file and skips headers already set, whatever their case', () => {
    const current = JSON.stringify({
      cleanUrls: true,
      headers: [
        { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
        { source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
      ],
    })
    const edit = writeHeaders(current, headers)
    expect(edit.added).toEqual(['x-content-type-options'])
    const config = JSON.parse(edit.content)
    expect(config.cleanUrls).toBe(true)
    expect(config.headers[0].headers).toEqual([{ key: 'Cache-Control', value: 'no-store' }])
    expect(config.headers[1].headers).toEqual([{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'x-content-type-options', value: 'nosniff' }])
  })

  it('adds nothing when every header is there', () => {
    const current = writeHeaders(undefined, headers).content
    expect(writeHeaders(current, headers).added).toEqual([])
  })
})

describe('vercel.deployment', () => {
  const checks = (names: [string, string][]): Checks => ({
    state: 'success',
    warning: null,
    items: names.map(([name, state]) => ({ name, state, url: `https://example.com/${name}`, description: null })),
  })

  it('picks the Vercel check among the others', async () => {
    const d = await providers.vercel.deployment('o/r', 'sha', checks([['ci / test', 'success'], ['Vercel', 'pending']]))
    expect(d).toMatchObject({ name: 'Vercel', state: 'pending' })
  })

  it('returns null when Vercel did not report', async () => {
    expect(await providers.vercel.deployment('o/r', 'sha', checks([['ci / test', 'success']]))).toBeNull()
  })
})

describe('deployProvider', () => {
  it('returns the provider stored on the target', () => {
    expect(deployProvider('netlify')).toBe(providers.netlify)
    expect(deployProvider('cloudflare')).toBe(providers.cloudflare)
    expect(deployProvider('generic')).toBe(providers.generic)
  })

  it('falls back to Vercel on a missing or unknown value', () => {
    expect(deployProvider(null)).toBe(providers.vercel)
    expect(deployProvider('heroku')).toBe(providers.vercel)
    // Inherited keys are not providers
    expect(isProviderId('toString')).toBe(false)
    expect(deployProvider('__proto__')).toBe(providers.vercel)
  })
})

describe('logsHint', () => {
  const unset = { vercelToken: '', netlifyToken: '', cloudflareToken: '', cloudflareAccountId: '' }

  beforeEach(() => {
    Object.assign(runtimeConfig, unset)
  })

  it('names the env variables of the provider', () => {
    expect(logsHint(providers.vercel)).toBe('Set NUXT_VERCEL_TOKEN to see the build log here.')
    expect(logsHint(providers.netlify)).toBe('Set NUXT_NETLIFY_TOKEN to see the deploy error here.')
    expect(logsHint(providers.cloudflare)).toBe('Set NUXT_CLOUDFLARE_TOKEN and NUXT_CLOUDFLARE_ACCOUNT_ID to see the build log here.')
  })

  it('only names what is missing', () => {
    runtimeConfig.cloudflareToken = 't'
    expect(logsHint(providers.cloudflare)).toBe('Set NUXT_CLOUDFLARE_ACCOUNT_ID to see the build log here.')
  })

  it('asks for nothing once everything is set', () => {
    Object.assign(runtimeConfig, { vercelToken: 't', netlifyToken: 't' })
    expect(logsHint(providers.vercel)).toBe('No build log available for this deployment.')
    expect(logsHint(providers.netlify)).toBe('No deploy error available for this deployment.')
  })

  it('asks for no token when the provider keeps no log', () => {
    expect(logsHint(providers.generic)).toBe('GitHub Deployments keeps no build log.')
  })

  it('only reads keys declared in nuxt.config', () => {
    const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
    for (const p of Object.values(providers)) {
      for (const key of p.logsConfig) expect(config).toContain(`${key}: ''`)
    }
  })
})
