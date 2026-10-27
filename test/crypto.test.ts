import { randomBytes, scryptSync } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { bearerMatches, checkPassword, decrypt, encrypt } from '../server/utils/crypto'
import { runtimeConfig } from './stubs/imports'

beforeEach(() => {
  runtimeConfig.secretKey = randomBytes(32).toString('hex')
})

describe('encrypt and decrypt', () => {
  it('round trips', () => {
    const blob = encrypt('Cookie: session=secret')
    expect(blob).not.toContain('secret')
    expect(decrypt(blob)).toBe('Cookie: session=secret')
  })

  it('uses a fresh IV every time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })

  it('detects tampering', () => {
    const [iv, tag, data] = encrypt('payload').split('.')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0]! ^= 1
    expect(() => decrypt([iv, tag, flipped.toString('base64')].join('.'))).toThrow()
  })

  it('rejects a truncated auth tag', () => {
    const [iv, tag, data] = encrypt('payload').split('.')
    const short = Buffer.from(tag!, 'base64').subarray(0, 4).toString('base64')
    expect(() => decrypt([iv, short, data].join('.'))).toThrow()
  })

  it('refuses a malformed key', () => {
    runtimeConfig.secretKey = 'short'
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })
})

describe('checkPassword', () => {
  it('matches the hash format of scripts/hash-password.mjs', () => {
    const salt = randomBytes(16)
    runtimeConfig.passwordHash = `${salt.toString('hex')}:${scryptSync('correct horse', salt, 64).toString('hex')}`
    expect(checkPassword('correct horse')).toBe(true)
    expect(checkPassword('wrong horse')).toBe(false)
  })

  it('refuses everything without a configured hash', () => {
    runtimeConfig.passwordHash = ''
    expect(checkPassword('')).toBe(false)
  })
})

describe('bearerMatches', () => {
  const token = 'a'.repeat(64)

  it('accepts the exact token only', () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true)
    expect(bearerMatches(`Bearer ${token}x`, token)).toBe(false)
    expect(bearerMatches(token, token)).toBe(false)
    expect(bearerMatches(undefined, token)).toBe(false)
  })

  it('is disabled by a short or empty token', () => {
    expect(bearerMatches('Bearer ', '')).toBe(false)
    expect(bearerMatches('Bearer short', 'short')).toBe(false)
  })
})
