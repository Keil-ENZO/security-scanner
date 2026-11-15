import { describe, expect, it } from 'vitest'
import { diffFindings, findingKey } from '../server/utils/diff'

const password = (location: string | null) => ({ tool: 'trivy', rule_id: 'compose-plain-password', title: 'Secret: Plain password in compose', location })

describe('findingKey', () => {
  it('keeps the file and drops the line', () => {
    expect(findingKey(password('compose.yaml:12'))).toBe(findingKey(password('compose.yaml:40')))
    expect(findingKey(password('compose.yaml:12'))).not.toBe(findingKey(password('deploy/compose.yaml:12')))
  })

  it('accepts a location without a line, or none', () => {
    expect(findingKey(password('pnpm-lock.yaml'))).toBe(findingKey(password('pnpm-lock.yaml:3')))
    expect(findingKey(password('src/a.ts:undefined'))).toBe(findingKey(password('src/a.ts:7')))
    expect(findingKey(password(null))).not.toBe(findingKey(password('compose.yaml')))
  })
})

describe('diffFindings', () => {
  it('counts the same rule in another file as introduced', () => {
    const base = [password('compose.yaml:12')]
    const branch = [password('compose.yaml:12'), password('deploy/compose.yaml:4')]
    const diff = diffFindings(base, branch)
    expect(diff.introduced).toEqual([password('deploy/compose.yaml:4')])
    expect(diff.resolved).toEqual([])
    expect(diff.remaining).toBe(1)
  })

  it('ignores a finding that only moved inside its file', () => {
    expect(diffFindings([password('compose.yaml:12')], [password('compose.yaml:31')]))
      .toEqual({ resolved: [], introduced: [], remaining: 1 })
  })

  it('counts a second occurrence in the same file as introduced', () => {
    const diff = diffFindings([password('compose.yaml:12')], [password('compose.yaml:12'), password('compose.yaml:20')])
    expect(diff.introduced).toHaveLength(1)
    expect(diff.remaining).toBe(1)
  })

  it('counts a removed occurrence as resolved', () => {
    const diff = diffFindings([password('compose.yaml:12'), password('compose.yaml:20')], [password('compose.yaml:12')])
    expect(diff.resolved).toHaveLength(1)
    expect(diff.introduced).toEqual([])
    expect(diff.remaining).toBe(1)
  })

  it('sees a finding moved to another file as resolved and introduced', () => {
    const diff = diffFindings([password('compose.yaml:12')], [password('compose.prod.yaml:12')])
    expect(diff.resolved).toEqual([password('compose.yaml:12')])
    expect(diff.introduced).toEqual([password('compose.prod.yaml:12')])
    expect(diff.remaining).toBe(0)
  })
})
