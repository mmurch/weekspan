import { normalizeTitle } from './normalizeTitle.js'

describe('normalizeTitle', () => {
  it('leaves an already-clean title untouched', () => {
    expect(normalizeTitle('order tile samples')).toBe('order tile samples')
  })

  it('collapses a newline into a single space', () => {
    expect(normalizeTitle('order tile\nsamples')).toBe('order tile samples')
  })

  it('collapses runs of repeated spaces', () => {
    expect(normalizeTitle('order   tile    samples')).toBe('order tile samples')
  })

  it('collapses a mix of newlines and repeated spaces', () => {
    expect(normalizeTitle('order  tile\n\n  samples\n')).toBe('order tile samples')
  })

  it('trims leading and trailing whitespace, including newlines', () => {
    expect(normalizeTitle('\n  order tile samples  \n')).toBe('order tile samples')
  })

  it('is idempotent', () => {
    const once = normalizeTitle('order   tile\nsamples')
    expect(normalizeTitle(once)).toBe(once)
  })

  it('handles an empty or all-whitespace string', () => {
    expect(normalizeTitle('')).toBe('')
    expect(normalizeTitle('   \n  ')).toBe('')
  })
})
