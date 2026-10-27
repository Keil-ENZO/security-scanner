import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { useRuntimeConfig } from '#imports'

function key() {
  const hex = useRuntimeConfig().secretKey
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('NUXT_SECRET_KEY must be 32 bytes in hex')
  }
  return Buffer.from(hex, 'hex')
}

// AES-256-GCM: iv.tag.data, base64
export function encrypt(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.')
}

export function decrypt(blob: string) {
  const [iv, tag, data] = blob.split('.').map(s => Buffer.from(s, 'base64'))
  // Fixed tag length: a truncated tag must not verify
  const decipher = createDecipheriv('aes-256-gcm', key(), iv!, { authTagLength: 16 })
  decipher.setAuthTag(tag!)
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8')
}

// salt:hash in hex, produced by scripts/hash-password.mjs
export function checkPassword(password: string) {
  const [salt, hash] = useRuntimeConfig().passwordHash.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

// Constant-time bearer check. A token under 32 characters disables the endpoint
export function bearerMatches(header: string | undefined, expected: string) {
  if (expected.length < 32 || !header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}
