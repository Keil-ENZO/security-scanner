export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const target = useDb().prepare(`
    SELECT id, name, repo, url, weekly, auth_header IS NOT NULL AS has_auth FROM targets WHERE id = ?
  `).get(id)
  if (!target) throw createError({ statusCode: 404, message: 'Cible inconnue' })
  return target
})
