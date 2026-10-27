import { z } from 'zod'

const Body = z.object({ password: z.string().min(1).max(256) })

export default defineEventHandler(async (event) => {
  const { password } = await readValidatedBody(event, Body.parse)
  if (!checkPassword(password)) {
    // Slows down brute force
    await new Promise(r => setTimeout(r, 1000))
    throw createError({ statusCode: 401, message: 'Wrong password' })
  }
  await setUserSession(event, { user: { name: 'admin' } })
  return { ok: true }
})
