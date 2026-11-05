import { describe, expect, it } from 'vitest'
import { deployProvider, isProviderId, providers } from '../server/utils/providers'
import type { Checks } from '../server/utils/github'

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
