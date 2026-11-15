// Filters of the scan page, kept out of the page so they can be tested
interface Filterable { tool: string, severity: string, title: string, location: string | null, rule_id: string | null }

// The search reads the title, the location and the rule id, whatever the case
export function matchFinding(f: Filterable, filter: { tool: string, severity: string, query: string }) {
  if (filter.tool && f.tool !== filter.tool) return false
  if (filter.severity && f.severity !== filter.severity) return false
  const q = filter.query.trim().toLowerCase()
  return !q || [f.title, f.location, f.rule_id].some(v => v?.toLowerCase().includes(q))
}

// Only the tools that reported something, with their count, sorted by name
export function toolCounts(findings: { tool: string }[]) {
  const counts = new Map<string, number>()
  for (const f of findings) counts.set(f.tool, (counts.get(f.tool) ?? 0) + 1)
  return [...counts].map(([tool, count]) => ({ tool, count })).sort((a, b) => a.tool.localeCompare(b.tool))
}
