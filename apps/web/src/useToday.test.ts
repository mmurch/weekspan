import { describe, expect, it } from 'vitest'
import { isoDateOf, msUntilNextMidnight } from './useToday.js'

describe('isoDateOf', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(isoDateOf(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05')
    expect(isoDateOf(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31')
  })
})

describe('msUntilNextMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 9, 23, 0, 0))).toBe(60 * 60 * 1000)
  })
  it('is a full day just after midnight, never zero', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 9, 0, 0, 0, 0))).toBe(24 * 60 * 60 * 1000)
    expect(msUntilNextMidnight(new Date(2026, 9, 9, 23, 59, 59, 999))).toBe(1)
  })
})
