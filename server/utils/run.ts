import { spawn } from 'node:child_process'

const MAX_OUTPUT = 100 * 1024 * 1024

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

// Guardrail 3: never a shell. Scanners do not see the app secrets,
// only a minimal environment and what is passed to them explicitly
export function run(cmd: string, args: string[], opts: { cwd?: string, env?: Record<string, string>, timeoutMs: number }) {
  return new Promise<RunResult>((resolve, reject) => {
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      LANG: 'C.UTF-8',
      ...opts.env,
    }
    const child = spawn(cmd, args, { cwd: opts.cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let size = 0
    let stderr = ''
    let killed = ''

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) {
        killed = 'output too large'
        child.kill('SIGKILL')
      }
      else out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000)
    })
    const timer = setTimeout(() => {
      killed = `timed out after ${Math.round(opts.timeoutMs / 60000)} min`
      child.kill('SIGKILL')
    }, opts.timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) return reject(new Error(`${cmd} stopped: ${killed}`))
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr })
    })
  })
}
