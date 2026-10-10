const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,99}?)(?:\.git)?\/?$/
const HEADER_RE = /^([A-Za-z0-9-]{1,64}):\s*([^\r\n]{1,8192})$/

function refuse(statusCode: number, message: string): never {
  throw createError({ statusCode, message: message })
}

// Garde-fou 1 : seuls les dépôts des propriétaires autorisés
export function parseRepo(input: string) {
  const match = REPO_RE.exec(input.trim())
  if (!match) refuse(400, 'Dépôt invalide, format attendu : https://github.com/<propriétaire>/<dépôt>')
  const [, owner, repo] = match
  if (!scannerConfig().owners.includes(owner!.toLowerCase())) {
    refuse(403, `Propriétaire ${owner} hors de l'allowlist`)
  }
  return `${owner}/${repo}`
}

// Garde-fou 5 : seuls les domaines autorisés, *.exemple.com couvre les sous-domaines
export function parseSite(input: string) {
  let url: URL
  try {
    url = new URL(input.trim())
  }
  catch {
    refuse(400, 'URL invalide')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') refuse(400, 'URL en http ou https uniquement')
  if (url.username || url.password) refuse(400, 'Pas d’identifiants dans l’URL')
  const host = url.hostname.toLowerCase()
  const allowed = scannerConfig().hosts.some(h =>
    h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h,
  )
  if (!allowed) refuse(403, `Domaine ${host} hors de l'allowlist`)
  return `${url.origin}${url.pathname}`
}

export function parseAuthHeader(input: string) {
  const match = HEADER_RE.exec(input.trim())
  if (!match) refuse(400, 'Header invalide, format attendu : Nom: valeur')
  return { key: match[1]!, value: match[2]!.trim() }
}
