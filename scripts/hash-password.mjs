// Usage : node scripts/hash-password.mjs, puis taper le mot de passe
import { randomBytes, scryptSync } from 'node:crypto'
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })
rl.question('Mot de passe : ', (password) => {
  rl.close()
  if (password.length < 12) {
    console.error('12 caractères minimum')
    process.exit(1)
  }
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  console.log(`NUXT_PASSWORD_HASH=${salt.toString('hex')}:${hash.toString('hex')}`)
})
