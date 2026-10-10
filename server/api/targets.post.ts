import { z } from 'zod'

const Body = z.object({
  name: z.string().trim().min(1).max(100),
  repo: z.string().trim().max(300).optional(),
  url: z.string().trim().max(500).optional(),
  authHeader: z.string().trim().max(8300).optional(),
  weekly: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, Body.parse)
  if (!body.repo && !body.url) {
    throw createError({ statusCode: 400, message: 'Un dépôt ou une URL, au moins' })
  }
  if (body.authHeader && !body.url) {
    throw createError({ statusCode: 400, message: 'Les identifiants servent au scan du site : URL requise' })
  }
  const repo = body.repo ? parseRepo(body.repo) : null
  const url = body.url ? parseSite(body.url) : null
  let auth: string | null = null
  if (body.authHeader) {
    parseAuthHeader(body.authHeader)
    auth = encrypt(body.authHeader)
  }

  const { lastInsertRowid } = useDb()
    .prepare('INSERT INTO targets (name, repo, url, auth_header, weekly) VALUES (?, ?, ?, ?, ?)')
    .run(body.name, repo, url, auth, body.weekly ? 1 : 0)
  return { id: Number(lastInsertRowid) }
})
