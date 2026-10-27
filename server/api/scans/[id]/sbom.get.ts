// SBOM of the scanned commit, CycloneDX JSON, as a download
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const row = useDb().prepare(`
    SELECT b.content, t.name, s.sha FROM sboms b
    JOIN scans s ON s.id = b.scan_id JOIN targets t ON t.id = s.target_id WHERE b.scan_id = ?
  `).get(id) as { content: string, name: string, sha: string | null } | undefined
  if (!row) throw createError({ statusCode: 404, message: 'No SBOM for this scan' })
  const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'target'
  setHeader(event, 'content-type', 'application/vnd.cyclonedx+json')
  setHeader(event, 'content-disposition', `attachment; filename="${slug}-${row.sha?.slice(0, 7) ?? id}.cdx.json"`)
  return row.content
})
