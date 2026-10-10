import { z } from 'zod'

const Body = z.object({ ref: z.string().max(200).optional() }).optional()

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  const body = await readValidatedBody(event, b => Body.parse(b ?? undefined))
  const target = useDb().prepare('SELECT id, repo FROM targets WHERE id = ?').get(id) as { id: number, repo: string | null } | undefined
  if (!target) throw createError({ statusCode: 404, message: 'Cible inconnue' })
  const ref = body?.ref ? validRef(body.ref) : null
  if (ref && !target.repo) throw createError({ statusCode: 400, message: 'Pas de dépôt : pas de branche' })
  const { scanId } = enqueueScan(id, 'manuel', null, ref)
  return { scanId }
})
