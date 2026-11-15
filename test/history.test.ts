import { describe, expect, it } from 'vitest'
import { groupHistory, type HistoryScan } from '../server/utils/history'

let nextId = 0
const scan = (over: Partial<HistoryScan> = {}): HistoryScan => ({
  id: ++nextId, target: 'shop', ref: null, origin: 'manual', status: 'done', batch: null,
  created_at: '2026-01-05 03:00:00', critical: null, high: null, medium: null, low: null, total: 0, ...over,
})
const scheduled = (batch: string | null, over: Partial<HistoryScan> = {}) => scan({ origin: 'scheduled', batch, ...over })
// The API returns the newest scan first
const newestFirst = (rows: HistoryScan[]) => [...rows].reverse()

describe('groupHistory', () => {
  it('groups the scans of a batch into one entry with summed counts', () => {
    const rows = newestFirst([
      scheduled('b1', { target: 'shop', critical: 1, high: 2, total: 4, created_at: '2026-01-05 03:00:00' }),
      scheduled('b1', { target: 'blog', high: 1, low: 3, total: 4, created_at: '2026-01-05 03:00:01' }),
      scheduled('b1', { target: 'docs' }),
      scan({ target: 'shop', medium: 2, total: 2 }),
    ])
    const { entries, more } = groupHistory(rows, 10)
    expect(more).toBe(false)
    expect(entries.map(e => [e.origin, e.scans.length])).toEqual([['manual', 1], ['scheduled', 3]])
    expect(entries[1]).toMatchObject({
      key: 'b1', batch: 'b1', status: 'done', created_at: '2026-01-05 03:00:00',
      critical: 1, high: 3, medium: 0, low: 3, total: 8, finished: 3, failed: 0,
    })
    expect(entries[1]!.scans.map(s => s.target)).toEqual(['docs', 'blog', 'shop'])
  })

  it('keeps a batch whole when other scans were created in between', () => {
    const first = scheduled('b1')
    const manual = scan()
    const second = scheduled('b1')
    const { entries } = groupHistory([manual, second, first], 10)
    expect(entries.map(e => e.scans.map(s => s.id))).toEqual([[second.id, first.id], [manual.id]])
  })

  it('shows each scheduled scan without a batch as its own entry', () => {
    const rows = newestFirst([scheduled(null, { target: 'shop' }), scheduled(null, { target: 'blog' })])
    const { entries } = groupHistory(rows, 10)
    expect(entries).toHaveLength(2)
    expect(entries.every(e => e.origin === 'scheduled' && e.batch === null && e.scans.length === 1)).toBe(true)
    expect(new Set(entries.map(e => e.key)).size).toBe(2)
  })

  it('reports a batch as running until its last scan is finished', () => {
    const batch = (...statuses: string[]) =>
      groupHistory(statuses.map(status => scheduled('b1', { status })), 10).entries[0]!
    expect(batch('done', 'running', 'queued')).toMatchObject({ status: 'running', finished: 1 })
    // Between two scans of the queue nothing runs, the batch still does
    expect(batch('done', 'queued')).toMatchObject({ status: 'running', finished: 1 })
    expect(batch('queued', 'queued')).toMatchObject({ status: 'queued', finished: 0 })
    expect(batch('done', 'failed')).toMatchObject({ status: 'done', finished: 2, failed: 1 })
    expect(batch('failed', 'failed')).toMatchObject({ status: 'failed', failed: 2 })
  })

  it('keeps the status of a single scan', () => {
    expect(groupHistory([scan({ origin: 'fix', status: 'failed' })], 10).entries[0])
      .toMatchObject({ origin: 'fix', status: 'failed', failed: 1 })
  })

  it('counts a batch as one entry when paginating', () => {
    const rows = newestFirst([
      scan(),
      ...['shop', 'blog', 'docs'].map(target => scheduled('b1', { target })),
      scan(),
      ...['shop', 'blog', 'docs'].map(target => scheduled('b2', { target })),
    ])
    const page = groupHistory(rows, 3)
    expect(page.more).toBe(true)
    expect(page.entries.map(e => e.batch ?? e.origin)).toEqual(['b2', 'manual', 'b1'])
    expect(page.entries.flatMap(e => e.scans)).toHaveLength(7)
    expect(groupHistory(rows, 4).more).toBe(false)
  })
})
