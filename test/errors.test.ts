import { describe, expect, it } from 'vitest'
import { errorMessage } from '../app/utils/errors'

describe('errorMessage', () => {
  it('keeps the message of the server', () => {
    expect(errorMessage({ data: { message: 'Unknown target' } })).toBe('Unknown target')
  })

  it('falls back to the status text, then to a sentence', () => {
    expect(errorMessage({ statusMessage: 'Bad Gateway' })).toBe('Bad Gateway')
    expect(errorMessage(null)).toBe('The request failed. Check the server logs.')
    expect(errorMessage({}, 'GitHub error')).toBe('GitHub error')
  })

  it('reads the first issue of a schema refusal', () => {
    const issues = JSON.stringify([{ code: 'too_big', path: ['name'], message: 'Too big: expected string to have <=100 characters' }, { path: ['url'], message: 'Invalid URL' }])
    expect(errorMessage({ data: { message: issues } })).toBe('name: Too big: expected string to have <=100 characters')
    expect(errorMessage({ data: { message: JSON.stringify([{ path: [], message: 'Invalid input' }]) } })).toBe('Invalid input')
  })

  it('leaves a message that only looks like a list', () => {
    expect(errorMessage({ data: { message: '[trivy] timeout' } })).toBe('[trivy] timeout')
  })
})
