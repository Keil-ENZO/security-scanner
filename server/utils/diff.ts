// Comparison of two scans of the same repository: the default branch, then a branch

export interface DiffFinding { tool: string, rule_id: string | null, title: string, location: string | null }

// The file is enough: the line moves with every edit
const file = (location: string | null) => location?.replace(/:(\d+|undefined)$/, '') ?? ''

export const findingKey = (f: DiffFinding) => [f.tool, f.rule_id, f.title, file(f.location)].join('|')

// Findings of `from` with no counterpart in `other`.
// Counted: a second secret in a file that already has one is not matched by the first
function unmatched<T extends DiffFinding>(from: T[], other: T[]): T[] {
  const left = new Map<string, number>()
  for (const f of other) left.set(findingKey(f), (left.get(findingKey(f)) ?? 0) + 1)
  return from.filter((f) => {
    const k = findingKey(f)
    const n = left.get(k) ?? 0
    if (n) left.set(k, n - 1)
    return !n
  })
}

export function diffFindings<T extends DiffFinding>(before: T[], after: T[]) {
  const introduced = unmatched(after, before)
  return { resolved: unmatched(before, after), introduced, remaining: after.length - introduced.length }
}
