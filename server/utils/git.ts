import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

// Guardrail 4: the token goes through GIT_ASKPASS, never in the URL nor on the command line
export function gitEnv() {
  const { githubToken } = useRuntimeConfig()
  // No global or system config: no credential helper other than the scanner token
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  if (githubToken) {
    env.GIT_ASKPASS = askpassPath()
    env.SCANNER_GIT_TOKEN = githubToken
  }
  return env
}

export async function git(cwd: string, args: string[]) {
  const result = await run('git', args, { cwd, env: gitEnv(), timeoutMs: 5 * 60_000 })
  if (result.code !== 0) throw new Error(`git ${args[0]}: ${result.stderr.trim().slice(-500)}`)
  return result.stdout.trim()
}

export async function cloneRepo(repo: string, dest: string, ref?: string | null) {
  const { githubToken } = useRuntimeConfig()
  const env = gitEnv()
  const branch = ref ? ['--branch', validRef(ref)] : []
  const result = await run(
    'git',
    ['-c', 'protocol.file.allow=never', 'clone', '--depth', '1', '--quiet', ...branch, '--', `https://github.com/${repo}.git`, dest],
    { env, timeoutMs: 5 * 60_000 },
  )
  if (result.code !== 0) {
    if (!githubToken && /could not read Username/.test(result.stderr)) {
      throw new Error('private or missing repository. For a private repository, set NUXT_GITHUB_TOKEN')
    }
    throw new Error(`git clone: ${result.stderr.trim().slice(-500)}`)
  }
}
