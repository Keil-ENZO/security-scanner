import { describe, expect, it } from 'vitest'
import { openFindings, type TargetCounts } from '../app/utils/summary'

const target = (over: Partial<TargetCounts> = {}): TargetCounts => ({
  done_scan_id: 1, critical: null, high: null, medium: null, low: null, total: 0, ...over,
})

describe('openFindings', () => {
  it('adds up the latest finished scan of each target', () => {
    const sum = openFindings([
      target({ critical: 1, high: 2, medium: 3, low: 4, total: 11 }),
      target({ high: 5, low: 1, total: 6 }),
    ])
    expect(sum).toEqual({ critical: 1, high: 7, medium: 3, low: 5, total: 17, scanned: 2 })
  })

  it('counts a clean scan as scanned, with nothing open', () => {
    expect(openFindings([target()])).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0, scanned: 1 })
  })

  it('leaves out the targets without a finished scan', () => {
    const sum = openFindings([target({ critical: 2, total: 2 }), target({ done_scan_id: null })])
    expect(sum.scanned).toBe(1)
    expect(sum.total).toBe(2)
  })

  it('is empty without targets', () => {
    expect(openFindings([])).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0, scanned: 0 })
  })
})
