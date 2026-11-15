// Home history: the scans of one scheduled audit share a batch and show as one entry

export interface HistoryScan {
  id: number
  target: string
  ref: string | null
  origin: string
  status: string
  batch: string | null
  created_at: string
  // SUM() is NULL when a scan has no findings
  critical: number | null
  high: number | null
  medium: number | null
  low: number | null
  total: number
}

export interface HistoryEntry {
  key: string
  origin: string
  batch: string | null
  status: string
  created_at: string
  critical: number
  high: number
  medium: number
  low: number
  total: number
  finished: number
  failed: number
  scans: HistoryScan[]
}

const pending = (s: HistoryScan) => s.status === 'queued' || s.status === 'running'

// One scan still pending and the batch is not done, whatever the others say
function batchStatus(scans: HistoryScan[]) {
  if (scans.some(pending)) return scans.every(s => s.status === 'queued') ? 'queued' : 'running'
  return scans.every(s => s.status === 'failed') ? 'failed' : 'done'
}

const sum = (scans: HistoryScan[], key: 'critical' | 'high' | 'medium' | 'low' | 'total') =>
  scans.reduce((n, s) => n + (s[key] ?? 0), 0)

// An entry is a whole batch, or a single scan without one: manual, fix,
// and the scheduled scans older than the batch column.
// The limit counts entries, not scans. Pass one entry more than the limit to learn whether older ones exist
export function groupHistory(rows: HistoryScan[], limit: number) {
  const groups = new Map<string, HistoryScan[]>()
  for (const s of [...rows].sort((a, b) => b.id - a.id)) {
    const key = s.batch ?? `scan-${s.id}`
    groups.set(key, [...groups.get(key) ?? [], s])
  }
  const entries = [...groups].map(([key, scans]): HistoryEntry => ({
    key,
    origin: scans[0]!.origin,
    batch: scans[0]!.batch,
    status: scans.length > 1 ? batchStatus(scans) : scans[0]!.status,
    // The audit started with its first scan
    created_at: scans.at(-1)!.created_at,
    critical: sum(scans, 'critical'),
    high: sum(scans, 'high'),
    medium: sum(scans, 'medium'),
    low: sum(scans, 'low'),
    total: sum(scans, 'total'),
    finished: scans.filter(s => !pending(s)).length,
    failed: scans.filter(s => s.status === 'failed').length,
    scans,
  }))
  return { entries: entries.slice(0, limit), more: entries.length > limit }
}
