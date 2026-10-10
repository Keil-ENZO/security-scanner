export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const target = useDb().prepare('SELECT id FROM targets WHERE id = ?').get(id)
  if (!target) throw createError({ statusCode: 404, message: 'Cible inconnue' })
  const { scanId } = enqueueScan(id, 'manuel')
  return { scanId }
})
