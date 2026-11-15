import { describe, expect, it } from 'vitest'
import { matchFinding, toolCounts } from '../app/utils/findings'

const finding = (over: Partial<Parameters<typeof matchFinding>[0]> = {}) => ({
  tool: 'trivy', severity: 'high', title: 'lodash: Prototype Pollution', location: 'package-lock.json', rule_id: 'CVE-2020-8203', ...over,
})
const all = { tool: '', severity: '', query: '' }

describe('matchFinding', () => {
  it('keeps everything without a filter', () => {
    expect(matchFinding(finding(), all)).toBe(true)
  })

  it('filters on tool and severity together', () => {
    expect(matchFinding(finding(), { ...all, tool: 'trivy', severity: 'high' })).toBe(true)
    expect(matchFinding(finding(), { ...all, tool: 'grype' })).toBe(false)
    expect(matchFinding(finding(), { ...all, tool: 'trivy', severity: 'low' })).toBe(false)
  })

  it('searches the title, the location and the rule id, whatever the case', () => {
    expect(matchFinding(finding(), { ...all, query: 'PROTOTYPE' })).toBe(true)
    expect(matchFinding(finding(), { ...all, query: 'package-lock' })).toBe(true)
    expect(matchFinding(finding(), { ...all, query: 'cve-2020' })).toBe(true)
    expect(matchFinding(finding(), { ...all, query: 'express' })).toBe(false)
  })

  it('ignores spaces around the search and missing fields', () => {
    expect(matchFinding(finding(), { ...all, query: '  lodash  ' })).toBe(true)
    expect(matchFinding(finding({ location: null, rule_id: null }), { ...all, query: 'lodash' })).toBe(true)
    expect(matchFinding(finding({ location: null, rule_id: null }), { ...all, query: 'cve' })).toBe(false)
  })

  it('does not search the tool name', () => {
    expect(matchFinding(finding(), { ...all, query: 'trivy' })).toBe(false)
  })
})

describe('toolCounts', () => {
  it('lists only the tools that reported something, sorted by name', () => {
    const findings = [{ tool: 'trivy' }, { tool: 'nuclei' }, { tool: 'trivy' }]
    expect(toolCounts(findings)).toEqual([{ tool: 'nuclei', count: 1 }, { tool: 'trivy', count: 2 }])
  })

  it('returns nothing for a scan without findings', () => {
    expect(toolCounts([])).toEqual([])
  })
})
