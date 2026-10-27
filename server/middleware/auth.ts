// The whole API needs a session, except login and health.
// /api/automation/* needs the automation token instead
const PUBLIC = ['/api/login', '/api/_auth/session', '/api/health']

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || PUBLIC.includes(path)) return
  if (path.startsWith('/api/automation/')) {
    if (!bearerMatches(getHeader(event, 'authorization'), useRuntimeConfig().automationToken)) {
      throw createError({ statusCode: 401, message: 'Invalid automation token' })
    }
    return
  }
  await requireUserSession(event)
})
