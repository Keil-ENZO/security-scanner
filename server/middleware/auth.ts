// Toute l'API demande une session, sauf la connexion
const PUBLIC = ['/api/login', '/api/_auth/session']

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || PUBLIC.includes(path)) return
  await requireUserSession(event)
})
