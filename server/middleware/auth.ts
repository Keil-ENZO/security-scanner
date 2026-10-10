import { timingSafeEqual } from 'node:crypto'

// Toute l'API demande une session, sauf la connexion.
// /api/hermes/* demande le jeton du cron Hermes à la place
const PUBLIC = ['/api/login', '/api/_auth/session']

function hasHermesToken(header: string | undefined) {
  const expected = useRuntimeConfig().hermesToken
  if (expected.length < 32 || !header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || PUBLIC.includes(path)) return
  if (path.startsWith('/api/hermes/')) {
    if (!hasHermesToken(getHeader(event, 'authorization'))) {
      throw createError({ statusCode: 401, message: 'Jeton Hermes invalide' })
    }
    return
  }
  await requireUserSession(event)
})
