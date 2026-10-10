import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ASKPASS = `#!/bin/sh
case "$1" in
  Username*) echo x-access-token ;;
  *) echo "$SCANNER_GIT_TOKEN" ;;
esac
`

function askpassPath() {
  const path = join(useRuntimeConfig().dataDir, 'askpass.sh')
  if (!existsSync(path)) writeFileSync(path, ASKPASS, { mode: 0o700 })
  return path
}

// Garde-fou 3 : le jeton passe par GIT_ASKPASS, jamais dans l'URL ni sur la ligne de commande
export async function cloneRepo(repo: string, dest: string) {
  const { githubToken } = useRuntimeConfig()
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }
  if (githubToken) {
    env.GIT_ASKPASS = askpassPath()
    env.SCANNER_GIT_TOKEN = githubToken
  }
  const result = await run(
    'git',
    ['-c', 'protocol.file.allow=never', 'clone', '--depth', '1', '--quiet', '--', `https://github.com/${repo}.git`, dest],
    { env, timeoutMs: 5 * 60_000 },
  )
  if (result.code !== 0) {
    if (!githubToken && /could not read Username/.test(result.stderr)) {
      throw new Error('dépôt privé ou introuvable. Pour un dépôt privé, renseigner NUXT_GITHUB_TOKEN')
    }
    throw new Error(`git clone : ${result.stderr.trim().slice(-500)}`)
  }
}
