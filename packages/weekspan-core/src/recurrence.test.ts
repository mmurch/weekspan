import {
  currentPeriod,
  nextOccurrence,
  occursOn,
  occurrencesIn,
  validateRecurrence,
} from './recurrence.js'
import { addDays, weekEnd, weekOf, weekStart } from './dates.js'
import type { Recurrence } from './types.js'

describe('occurrencesIn — weekly', () => {
  it('generates every week on the given weekday, across a month and a year boundary', () => {
    // 2025-12-01 is a Monday.
    const rule: Recurrence = { freq: 'weekly', weekday: 1, anchor: '2025-12-01' }
    const got = occurrencesIn(rule, '2025-12-01', '2026-01-05')
    expect(got).toEqual([
      '2025-12-01',
      '2025-12-08',
      '2025-12-15',
      '2025-12-22',
      '2025-12-29',
      '2026-01-05',
    ])
  })

  it('never generates before the anchor', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 1, anchor: '2025-12-08' }
    const got = occurrencesIn(rule, '2025-12-01', '2025-12-31')
    expect(got[0]).toBe('2025-12-08')
    expect(got).not.toContain('2025-12-01')
  })
})

describe('occurrencesIn — biweekly phase anchoring', () => {
  // Anchor is a Wednesday, but the rule fires on Mondays — the anchor itself is
  // never an occurrence. It exists only to fix which fortnight is "on": the
  // anchor's week (the week of 2025-12-01..2025-12-07) is the on-phase week.
  //
  // This is deliberately the case that breaks a naive `daysBetween(anchor, d) % 14 === 0`
  // implementation: 2025-12-15 is a real occurrence here, but it is only 12 days
  // after the anchor (2025-12-03), and 12 % 14 !== 0.
  const rule: Recurrence = { freq: 'biweekly', weekday: 1, anchor: '2025-12-03' }

  it('fires every other Monday, phased off the anchor week — not off the anchor day-diff', () => {
    const got = occurrencesIn(rule, '2025-12-01', '2026-01-31')
    expect(got).toEqual(['2025-12-15', '2025-12-29', '2026-01-12', '2026-01-26'])
  })

  it('excludes the off-phase Mondays', () => {
    expect(occursOn(rule, '2025-12-08')).toBe(false)
    expect(occursOn(rule, '2025-12-22')).toBe(false)
  })

  it('excludes the on-phase Monday that falls before the anchor', () => {
    // 2025-12-01 is on-phase (delta 0 from anchor week) and a Monday, but it
    // precedes the anchor date (2025-12-03) so must not be generated.
    expect(occursOn(rule, '2025-12-01')).toBe(false)
  })

  it('catches the naive day-diff-mod-14 bug directly', () => {
    // If an implementation used daysBetween(anchor, d) % 14 === 0, this would
    // wrongly return false, since 2025-12-15 is 12 days after the anchor.
    expect(occursOn(rule, '2025-12-15')).toBe(true)
  })
})

describe('occurrencesIn — monthly', () => {
  it('on the 31st, skips short months entirely rather than clamping', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 31, anchor: '2026-01-31' }
    const got = occurrencesIn(rule, '2026-01-01', '2026-12-31')
    expect(got).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-08-31',
      '2026-10-31',
      '2026-12-31',
    ])
    expect(got.some((d) => d.startsWith('2026-02'))).toBe(false)
    expect(got.some((d) => d.startsWith('2026-04'))).toBe(false)
    expect(got.some((d) => d.startsWith('2026-06'))).toBe(false)
    expect(got.some((d) => d.startsWith('2026-09'))).toBe(false)
    expect(got.some((d) => d.startsWith('2026-11'))).toBe(false)
  })

  it('on the 29th, includes February in a leap year', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 29, anchor: '2024-01-29' }
    const got = occurrencesIn(rule, '2024-01-01', '2024-12-31')
    expect(got).toContain('2024-02-29')
  })

  it('on the 29th, excludes February in a non-leap year', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 29, anchor: '2023-01-29' }
    const got = occurrencesIn(rule, '2023-01-01', '2023-12-31')
    expect(got.some((d) => d.startsWith('2023-02'))).toBe(false)
  })
})

describe('occurrencesIn / occursOn — until bound', () => {
  const rule: Recurrence = {
    freq: 'weekly',
    weekday: 1,
    anchor: '2025-12-01',
    until: '2025-12-22',
  }

  it('is respected as an inclusive upper bound', () => {
    const got = occurrencesIn(rule, '2025-12-01', '2026-01-05')
    expect(got).toEqual(['2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22'])
  })

  it('occursOn agrees: the until date itself still occurs, the next one does not', () => {
    expect(occursOn(rule, '2025-12-22')).toBe(true)
    expect(occursOn(rule, '2025-12-29')).toBe(false)
  })
})

describe('occursOn agrees with occurrencesIn over a long range', () => {
  function checkAgreement(rule: Recurrence, from: string, to: string) {
    const set = new Set(occurrencesIn(rule, from, to))
    let cursor = from
    while (cursor <= to) {
      expect(occursOn(rule, cursor)).toBe(set.has(cursor))
      cursor = addDays(cursor, 1)
    }
  }

  it('weekly', () => {
    checkAgreement(
      { freq: 'weekly', weekday: 5, anchor: '2025-03-17' },
      '2025-01-01',
      '2026-12-31',
    )
  })

  it('biweekly, with an off-weekday anchor', () => {
    checkAgreement(
      { freq: 'biweekly', weekday: 4, anchor: '2025-06-02' },
      '2025-01-01',
      '2026-12-31',
    )
  })

  it('monthly, including a leap-year span', () => {
    checkAgreement(
      { freq: 'monthly', monthday: 30, anchor: '2023-11-30' },
      '2023-01-01',
      '2025-12-31',
    )
  })
})

describe('nextOccurrence', () => {
  it('finds the next weekly occurrence strictly after the given date', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 1, anchor: '2025-12-01' }
    expect(nextOccurrence(rule, '2025-12-01')).toBe('2025-12-08')
    // Even when `after` is itself an occurrence day, it must not be returned.
    expect(nextOccurrence(rule, '2025-12-08')).toBe('2025-12-15')
  })

  it('returns undefined once the series has ended', () => {
    const rule: Recurrence = {
      freq: 'weekly',
      weekday: 1,
      anchor: '2025-12-01',
      until: '2025-12-15',
    }
    expect(nextOccurrence(rule, '2025-12-15')).toBeUndefined()
    expect(nextOccurrence(rule, '2026-01-01')).toBeUndefined()
  })

  it('skips a short month for a monthly rule', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 31, anchor: '2026-01-31' }
    expect(nextOccurrence(rule, '2026-01-31')).toBe('2026-03-31')
  })
})

describe('currentPeriod', () => {
  it('weekly: the calendar week containing today', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 3, anchor: '2025-11-01' }
    const today = '2026-01-15'
    const w = weekOf(today)
    expect(currentPeriod(rule, today)).toEqual({ from: weekStart(w), to: weekEnd(w) })
  })

  it('biweekly: the fortnight aligned to the anchor phase, from either week in it', () => {
    // Same anchor/rule as the phase-anchoring tests above: on-phase week is
    // 2025-12-01..2025-12-07, so the fortnight 2025-12-15..2025-12-28 is "on".
    const rule: Recurrence = { freq: 'biweekly', weekday: 1, anchor: '2025-12-03' }

    // Queried from the on-phase week itself.
    expect(currentPeriod(rule, '2025-12-16')).toEqual({ from: '2025-12-15', to: '2025-12-28' })

    // Queried from the second (off-phase) week of the same fortnight — must
    // resolve to the same period, not a fresh one starting that week.
    expect(currentPeriod(rule, '2025-12-23')).toEqual({ from: '2025-12-15', to: '2025-12-28' })
  })

  it('monthly: the calendar month, non-leap February', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 3, anchor: '2025-01-03' }
    expect(currentPeriod(rule, '2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('monthly: the calendar month, leap February', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 3, anchor: '2024-01-03' }
    expect(currentPeriod(rule, '2024-02-15')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })

  it('monthly: an item completed early in the month still reads as done for the whole month', () => {
    // The period itself doesn't shift depending on when in the month the done
    // mark landed — a done on the 3rd and "today" on the 28th must resolve to
    // the same {from, to}, which is what lets the finished-state check treat
    // the rest of the month as covered.
    const rule: Recurrence = { freq: 'monthly', monthday: 3, anchor: '2026-01-03' }
    const doneDay = currentPeriod(rule, '2026-08-03')
    const laterInMonth = currentPeriod(rule, '2026-08-28')
    expect(doneDay).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(laterInMonth).toEqual(doneDay)
  })
})

describe('validateRecurrence', () => {
  it('accepts well-formed rules for every frequency', () => {
    expect(() =>
      validateRecurrence({ freq: 'weekly', weekday: 1, anchor: '2026-01-05' }),
    ).not.toThrow()
    expect(() =>
      validateRecurrence({ freq: 'biweekly', weekday: 7, anchor: '2026-01-05' }),
    ).not.toThrow()
    expect(() =>
      validateRecurrence({ freq: 'monthly', monthday: 31, anchor: '2026-01-05' }),
    ).not.toThrow()
    expect(() =>
      validateRecurrence({
        freq: 'monthly',
        monthday: 1,
        anchor: '2026-01-05',
        until: '2026-02-01',
      }),
    ).not.toThrow()
  })

  it('requires weekday in 1..7 for weekly/biweekly', () => {
    expect(() =>
      validateRecurrence({ freq: 'weekly', anchor: '2026-01-05' } as Recurrence),
    ).toThrow()
    expect(() =>
      validateRecurrence({ freq: 'weekly', weekday: 0, anchor: '2026-01-05' }),
    ).toThrow()
    expect(() =>
      validateRecurrence({ freq: 'weekly', weekday: 8, anchor: '2026-01-05' }),
    ).toThrow()
    expect(() =>
      validateRecurrence({ freq: 'biweekly', weekday: 1.5, anchor: '2026-01-05' }),
    ).toThrow()
  })

  it('requires monthday in 1..31 for monthly', () => {
    expect(() =>
      validateRecurrence({ freq: 'monthly', anchor: '2026-01-05' } as Recurrence),
    ).toThrow()
    expect(() =>
      validateRecurrence({ freq: 'monthly', monthday: 0, anchor: '2026-01-05' }),
    ).toThrow()
    expect(() =>
      validateRecurrence({ freq: 'monthly', monthday: 32, anchor: '2026-01-05' }),
    ).toThrow()
  })

  it('requires a valid anchor', () => {
    expect(() =>
      validateRecurrence({ freq: 'weekly', weekday: 1, anchor: 'not-a-date' }),
    ).toThrow()
    expect(() =>
      validateRecurrence({ freq: 'weekly', weekday: 1, anchor: '2026-02-30' }),
    ).toThrow()
  })

  it('requires until to be a valid date not before the anchor', () => {
    expect(() =>
      validateRecurrence({
        freq: 'weekly',
        weekday: 1,
        anchor: '2026-01-05',
        until: 'not-a-date',
      }),
    ).toThrow()
    expect(() =>
      validateRecurrence({
        freq: 'weekly',
        weekday: 1,
        anchor: '2026-01-05',
        until: '2026-01-01',
      }),
    ).toThrow()
    // until === anchor is allowed (a series that occurs exactly once).
    expect(() =>
      validateRecurrence({
        freq: 'weekly',
        weekday: 1,
        anchor: '2026-01-05',
        until: '2026-01-05',
      }),
    ).not.toThrow()
  })
})
