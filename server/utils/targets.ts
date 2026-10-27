import { createError } from '#imports'
import { scannerConfig } from './config'

const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,99}?)(?:\.git)?\/?$/
const HEADER_RE = /^([A-Za-z0-9-]{1,64}):\s*([^\r\n]{1,8192})$/

function refuse(statusCode: number, message: string): never {
  throw createError({ statusCode, message: message })
}

// Guardrail 1: only repositories of allowed owners
export function parseRepo(input: string) {
  const match = REPO_RE.exec(input.trim())
  if (!match) refuse(400, 'Invalid repository, expected https://github.com/<owner>/<repo>')
  const [, owner, repo] = match
  if (!scannerConfig().owners.includes(owner!.toLowerCase())) {
    refuse(403, `Owner ${owner} is not in the allowlist`)
  }
  return `${owner}/${repo}`
}

// Guardrail 2: only allowed domains. *.example.com covers subdomains
export function parseSite(input: string) {
  let url: URL
  try {
    url = new URL(input.trim())
  }
  catch {
    refuse(400, 'Invalid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') refuse(400, 'Only http and https URLs')
  if (url.username || url.password) refuse(400, 'No credentials in the URL')
  const host = url.hostname.toLowerCase()
  const allowed = scannerConfig().hosts.some(h =>
    h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h,
  )
  if (!allowed) refuse(403, `Domain ${host} is not in the allowlist`)
  return `${url.origin}${url.pathname}`
}

export function parseAuthHeader(input: string) {
  const match = HEADER_RE.exec(input.trim())
  if (!match) refuse(400, 'Invalid header, expected Name: value')
  return { key: match[1]!, value: match[2]!.trim() }
}
