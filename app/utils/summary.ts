// Home summary: open findings across the targets

export interface TargetCounts {
  // Latest finished scan of the default branch, null when there is none
  done_scan_id: number | null
  // SUM() is NULL when that scan has no findings
  critical: number | null
  high: number | null
  medium: number | null
  low: number | null
  total: number
}

// What is open now: the counts of the latest finished scan of each target, added up.
// scanned tells how many targets the sum covers
export function openFindings(targets: TargetCounts[]) {
  const sum = { critical: 0, high: 0, medium: 0, low: 0, total: 0, scanned: 0 }
  for (const t of targets) {
    if (!t.done_scan_id) continue
    sum.scanned++
    sum.critical += t.critical ?? 0
    sum.high += t.high ?? 0
    sum.medium += t.medium ?? 0
    sum.low += t.low ?? 0
    sum.total += t.total
  }
  return sum
}
