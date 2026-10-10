import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ASKPASS = `#!/bin/sh
case "$1" in
  Username*) echo x-access-token ;;
  *) echo "$SCANNER_GIT_TOKEN" ;;
esac
`

function askpassPath() {
  const path = resolve(useRuntimeConfig().dataDir, 'askpass.sh')
  if (!existsSync(path)) writeFileSync(path, ASKPASS, { mode: 0o700 })
  return path
}

// Garde-fou 3 : le jeton passe par GIT_ASKPASS, jamais dans l'URL ni sur la ligne de commande
export function gitEnv() {
  const { githubToken } = useRuntimeConfig()
  // Aucune config globale ni système : pas d'autre credential helper que le jeton du scanner
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  if (githubToken) {
    env.GIT_ASKPASS = askpassPath()
    env.SCANNER_GIT_TOKEN = githubToken
  }
  return env
}

export async function git(cwd: string, args: string[]) {
  const result = await run('git', args, { cwd, env: gitEnv(), timeoutMs: 5 * 60_000 })
  if (result.code !== 0) throw new Error(`git ${args[0]} : ${result.stderr.trim().slice(-500)}`)
  return result.stdout.trim()
}

export async function cloneRepo(repo: string, dest: string) {
  const { githubToken } = useRuntimeConfig()
  const env = gitEnv()
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
