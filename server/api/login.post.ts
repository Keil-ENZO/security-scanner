import { z } from 'zod'

const Body = z.object({ password: z.string().min(1).max(256) })

export default defineEventHandler(async (event) => {
  const { password } = await readValidatedBody(event, Body.parse)
  if (!checkPassword(password)) {
    // Ralentit le bourrinage
    await new Promise(r => setTimeout(r, 1000))
    throw createError({ statusCode: 401, message: 'Mot de passe incorrect' })
  }
  await setUserSession(event, { user: { name: 'enzo' } })
  return { ok: true }
})
