// Liveness for Docker and orchestrators. Public, says nothing about the targets
export default defineEventHandler(() => {
  useDb()
  return { ok: true }
})
