import type { Ledger } from './types.js'
import { computeWindow, isWeekInWindow, oldestUnclosedWeek, windowDateRange } from './window.js'

function ledgerWith(closedThrough: Ledger['closedThrough']): Ledger {
  return {
    version: 1,
    closedThrough,
    vacationDays: [],
    projects: [],
    items: [],
  }
}

const TODAY = '2026-08-26' // Wednesday, 2026-W35

describe('computeWindow', () => {
  it('caught-up case: exactly four blocks, current week first, none past', () => {
    const window = computeWindow(ledgerWith('2026-W34'), TODAY)

    expect(window.from).toBe('2026-W35')
    expect(window.to).toBe('2026-W38')
    expect(window.currentWeek).toBe('2026-W35')
    expect(window.weeks.map((w) => w.week)).toEqual(['2026-W35', '2026-W36', '2026-W37', '2026-W38'])
    expect(window.weeks.every((w) => !w.isPast)).toBe(true)
    expect(window.weeks[0]!.isCurrent).toBe(true)
    expect(window.weeks[0]!.isOldestUnclosed).toBe(true)
  })

  it('normal case: last week dimmed and flagged oldest-unclosed', () => {
    const window = computeWindow(ledgerWith('2026-W33'), TODAY)

    expect(window.weeks.map((w) => w.week)).toEqual(['2026-W34', '2026-W35', '2026-W36', '2026-W37'])
    expect(window.from).toBe('2026-W34')
    expect(window.to).toBe('2026-W37')

    const [w34, w35] = window.weeks
    expect(w34!.isPast).toBe(true)
    expect(w34!.isOldestUnclosed).toBe(true)
    expect(w35!.isCurrent).toBe(true)
    expect(w35!.isPast).toBe(false)
  })

  it('fresh ledger starts at the week before the current one', () => {
    const window = computeWindow(ledgerWith(null), TODAY)

    expect(window.from).toBe('2026-W34')
    expect(oldestUnclosedWeek(ledgerWith(null), TODAY)).toBe('2026-W34')
  })

  it('three weeks behind: window grows leftward to cover the whole backlog', () => {
    const window = computeWindow(ledgerWith('2026-W31'), TODAY)

    expect(window.weeks.map((w) => w.week)).toEqual([
      '2026-W32',
      '2026-W33',
      '2026-W34',
      '2026-W35',
      '2026-W36',
      '2026-W37',
    ])
    expect(window.weeks).toHaveLength(6)

    const oldestFlags = window.weeks.filter((w) => w.isOldestUnclosed)
    expect(oldestFlags).toHaveLength(1)
    expect(oldestFlags[0]!.week).toBe('2026-W32')
  })

  it('clamps when closedThrough is at the current week: never inverted or empty', () => {
    const atCurrent = computeWindow(ledgerWith('2026-W35'), TODAY)
    expect(atCurrent.from).toBe('2026-W35')
    expect(atCurrent.to >= atCurrent.from).toBe(true)
    expect(atCurrent.weeks.length).toBeGreaterThan(0)
    expect(atCurrent.weeks[0]!.week).toBe(atCurrent.from)

    const pastCurrent = computeWindow(ledgerWith('2026-W40'), TODAY)
    expect(pastCurrent.from).toBe('2026-W35')
    expect(pastCurrent.to >= pastCurrent.from).toBe(true)
    expect(pastCurrent.weeks.length).toBeGreaterThan(0)
  })

  it('exactly one week in the window is isOldestUnclosed, across several scenarios', () => {
    const scenarios: Array<Ledger['closedThrough']> = ['2026-W34', '2026-W33', '2026-W31', null, '2026-W35', '2026-W40']
    for (const closedThrough of scenarios) {
      const window = computeWindow(ledgerWith(closedThrough), TODAY)
      const flagged = window.weeks.filter((w) => w.isOldestUnclosed)
      expect(flagged).toHaveLength(1)
      expect(flagged[0]!.week).toBe(window.from)
    }
  })

  it('year-boundary case: exercises the 53-week year', () => {
    const today = '2027-01-04' // Monday, 2027-W01
    const window = computeWindow(ledgerWith('2026-W52'), today)

    expect(window.currentWeek).toBe('2027-W01')
    expect(window.from).toBe('2026-W53')
    expect(window.weeks.map((w) => w.week)).toEqual(['2026-W53', '2027-W01', '2027-W02', '2027-W03'])
    expect(window.weeks[0]!.isPast).toBe(true)
    expect(window.weeks[0]!.isOldestUnclosed).toBe(true)
    expect(window.weeks[1]!.isCurrent).toBe(true)
  })
})

describe('oldestUnclosedWeek', () => {
  it('is closedThrough + 1 when set', () => {
    expect(oldestUnclosedWeek(ledgerWith('2026-W33'), TODAY)).toBe('2026-W34')
  })

  it('clamps to the current week rather than going past it', () => {
    expect(oldestUnclosedWeek(ledgerWith('2026-W35'), TODAY)).toBe('2026-W35')
    expect(oldestUnclosedWeek(ledgerWith('2026-W99'.replace('99', '40')), TODAY)).toBe('2026-W35')
  })
})

describe('isWeekInWindow', () => {
  it('is true for edges and interior weeks, false outside', () => {
    const window = computeWindow(ledgerWith('2026-W33'), TODAY)
    expect(isWeekInWindow(window, window.from)).toBe(true)
    expect(isWeekInWindow(window, window.to)).toBe(true)
    expect(isWeekInWindow(window, '2026-W35')).toBe(true)
    expect(isWeekInWindow(window, '2026-W33')).toBe(false)
    expect(isWeekInWindow(window, '2026-W38')).toBe(false)
  })
})

describe('windowDateRange', () => {
  it('spans Monday of the first week through Sunday of the last', () => {
    const window = computeWindow(ledgerWith('2026-W34'), TODAY)
    expect(windowDateRange(window)).toEqual({ from: '2026-08-24', to: '2026-09-20' })
  })
})
