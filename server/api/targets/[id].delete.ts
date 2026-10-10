export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  useDb().prepare('DELETE FROM targets WHERE id = ?').run(id)
  return { ok: true }
})
