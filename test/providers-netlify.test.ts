import { describe, expect, it } from 'vitest'
import { netlifyDeployId, netlifyProvider } from '../server/utils/deploy-netlify'
import { providers } from '../server/utils/providers'
import type { Checks } from '../server/utils/github'

const headers = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' }
const { writeHeaders } = netlifyProvider

describe('netlify.writeHeaders', () => {
  it('creates netlify.toml with a catch-all block', () => {
    const edit = writeHeaders(undefined, headers)
    expect(edit.added).toEqual(['x-content-type-options', 'x-frame-options'])
    expect(edit.content).toBe([
      '[[headers]]',
      '  for = "/*"',
      '  [headers.values]',
      '    x-content-type-options = "nosniff"',
      '    x-frame-options = "SAMEORIGIN"',
      '',
    ].join('\n'))
  })

  it('appends a block to a file without headers and keeps the rest', () => {
    const current = '[build]\n  command = "pnpm build" # comment\n  publish = "dist"\n'
    const edit = writeHeaders(current, headers)
    expect(edit.content.startsWith(`${current}\n[[headers]]\n  for = "/*"\n`)).toBe(true)
    expect(edit.content.endsWith('    x-frame-options = "SAMEORIGIN"\n')).toBe(true)
  })

  it('extends the existing /* block, skipping headers set in any case', () => {
    const current = [
      '[build]',
      '  publish = "dist"',
      '',
      '[[headers]]',
      '  for = "/api/*"',
      '  [headers.values]',
      '    Cache-Control = "no-store"',
      '',
      '[[headers]]',
      '  for = \'/*\'',
      '  [headers.values]',
      '    "X-Frame-Options" = "DENY"',
      '    # keep me',
      '',
      '[[redirects]]',
      '  from = "/old"',
      '  to = "/new"',
      '',
    ].join('\r\n')
    const edit = writeHeaders(current, headers)
    expect(edit.added).toEqual(['x-content-type-options'])
    expect(edit.content).toBe(current.replace(
      '    "X-Frame-Options" = "DENY"\r\n',
      '    "X-Frame-Options" = "DENY"\r\n    x-content-type-options = "nosniff"\r\n',
    ))
  })

  it('adds a values table to a /* block without one', () => {
    const current = '[[headers]]\n  for = "/*"\n\n[[redirects]]\n  from = "/a"\n  to = "/b"\n'
    const edit = writeHeaders(current, { 'x-frame-options': 'SAMEORIGIN' })
    expect(edit.content).toBe('[[headers]]\n  for = "/*"\n  [headers.values]\n    x-frame-options = "SAMEORIGIN"\n\n[[redirects]]\n  from = "/a"\n  to = "/b"\n')
  })

  it('leaves the file alone when every header is there', () => {
    const current = writeHeaders(undefined, headers).content
    expect(writeHeaders(current, headers)).toEqual({ content: current, added: [] })
    const inline = '[[headers]]\n  for = "/*"\n  values = { X-Frame-Options = "DENY", "X-Content-Type-Options" = "nosniff" }\n'
    expect(writeHeaders(inline, headers)).toEqual({ content: inline, added: [] })
  })
})

describe('netlify.deployment', () => {
  const checks = (items: [string, string, string | null][]): Checks => ({
    state: 'success',
    warning: null,
    items: items.map(([name, state, url]) => ({ name, state, url, description: null })),
  })
  const deployUrl = 'https://app.netlify.com/sites/my-site/deploys/65a1b2c3d4e5f60718293a4b'

  it('is registered', () => {
    expect(providers.netlify).toBe(netlifyProvider)
  })

  it('picks the Netlify status linking to a deploy', async () => {
    const d = await netlifyProvider.deployment('o/r', 'sha', checks([
      ['ci / test', 'success', null],
      ['netlify/my-site/header-rules', 'success', 'https://app.netlify.com/sites/my-site/headers'],
      ['netlify/my-site/deploy-preview', 'failure', deployUrl],
    ]))
    expect(d).toMatchObject({ name: 'netlify/my-site/deploy-preview', state: 'failure' })
  })

  it('falls back to any Netlify check, null without one', async () => {
    expect(await netlifyProvider.deployment('o/r', 'sha', checks([['Netlify Deploy', 'pending', null]]))).toMatchObject({ name: 'Netlify Deploy' })
    expect(await netlifyProvider.deployment('o/r', 'sha', checks([['Vercel', 'success', null]]))).toBeNull()
  })
})

describe('netlifyDeployId', () => {
  it('reads the id from a deploy page', () => {
    expect(netlifyDeployId('https://app.netlify.com/sites/my-site/deploys/65a1b2c3d4e5f60718293a4b')).toBe('65a1b2c3d4e5f60718293a4b')
    expect(netlifyDeployId('https://app.netlify.com/projects/my.site/deploys/65a1b2c3d4e5f60718293a4b?filter=x')).toBe('65a1b2c3d4e5f60718293a4b')
  })

  it('rejects anything else', () => {
    expect(netlifyDeployId(null)).toBeNull()
    expect(netlifyDeployId('https://deploy-preview-1--my-site.netlify.app')).toBeNull()
    expect(netlifyDeployId('https://app.netlify.com/sites/my-site/deploys/../../user')).toBeNull()
    expect(netlifyDeployId('https://app.netlify.com/sites/my-site/deploys/65a1b2c3d4e5f60718293a4bff')).toBeNull()
    expect(netlifyDeployId('https://evil.example/app.netlify.com/sites/s/deploys/65a1b2c3d4e5f60718293a4b')).toBeNull()
  })
})
