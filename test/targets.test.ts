import { beforeEach, describe, expect, it } from 'vitest'
import { parseAuthHeader, parseRepo, parseSite } from '../server/utils/targets'
import { runtimeConfig } from './stubs/imports'

beforeEach(() => {
  runtimeConfig.allowedOwners = 'acme, Octo-Org'
  runtimeConfig.allowedHosts = 'example.com,*.example.org'
})

describe('parseRepo', () => {
  it('accepts an allowed owner, case insensitive', () => {
    expect(parseRepo('https://github.com/ACME/app')).toBe('ACME/app')
    expect(parseRepo('https://github.com/octo-org/my.repo.git')).toBe('octo-org/my.repo')
  })

  it('rejects an owner outside the allowlist', () => {
    expect(() => parseRepo('https://github.com/evil/app')).toThrow(/allowlist/)
  })

  it.each([
    'http://github.com/acme/app',
    'https://gitlab.com/acme/app',
    'https://github.com/acme/app/../other',
    'https://github.com/acme/..',
    'https://github.com/acme',
    'git@github.com:acme/app.git',
    'https://github.com/acme/app?x=1',
  ])('rejects malformed input %s', (input) => {
    expect(() => parseRepo(input)).toThrow()
  })
})

describe('parseSite', () => {
  it('accepts an exact host', () => {
    expect(parseSite('https://example.com/path?q=1#x')).toBe('https://example.com/path')
  })

  it('accepts subdomains of a wildcard entry only', () => {
    expect(parseSite('https://app.example.org')).toBe('https://app.example.org/')
    expect(() => parseSite('https://example.org')).toThrow(/allowlist/)
  })

  it.each([
    'https://evil.com',
    'https://example.com.evil.com',
    'https://notexample.com',
    'https://evilexample.org',
    'https://sub.example.com',
  ])('rejects a host outside the allowlist: %s', (input) => {
    expect(() => parseSite(input)).toThrow(/allowlist/)
  })

  it('rejects credentials and other schemes', () => {
    expect(() => parseSite('https://user:pass@example.com')).toThrow(/credentials/)
    expect(() => parseSite('ftp://example.com')).toThrow(/http/)
    expect(() => parseSite('file:///etc/passwd')).toThrow()
    expect(() => parseSite('not a url')).toThrow(/Invalid URL/)
  })
})

describe('parseAuthHeader', () => {
  it('splits name and value', () => {
    expect(parseAuthHeader('Cookie: session=abc; x=y')).toEqual({ key: 'Cookie', value: 'session=abc; x=y' })
  })

  it('rejects header injection', () => {
    expect(() => parseAuthHeader('Cookie: a\r\nX-Evil: 1')).toThrow()
    expect(() => parseAuthHeader('Bad Name: 1')).toThrow()
  })
})
