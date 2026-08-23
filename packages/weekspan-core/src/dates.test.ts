import {
  addDays,
  addWeeks,
  allWeekDates,
  daysBetween,
  fromDate,
  isValidIsoDate,
  isValidIsoWeek,
  isWeekend,
  toDate,
  weekEnd,
  weekOf,
  weekRange,
  weekStart,
  weekday,
  weekdayDates,
  weekendDates,
  weeksBetween,
} from './dates.js'

describe('toDate / validation', () => {
  it('rejects dates that do not exist', () => {
    expect(() => toDate('2026-02-30')).toThrow()
    expect(() => toDate('2025-02-29')).toThrow() // 2025 is not a leap year
    expect(() => toDate('2026-13-01')).toThrow()
    expect(isValidIsoDate('2026-02-29')).toBe(false)
  })

  it('accepts a real leap day', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
  })

  it('rejects malformed shapes', () => {
    for (const bad of ['2026-8-26', '26-08-26', '2026/08/26', '', 'today']) {
      expect(isValidIsoDate(bad)).toBe(false)
    }
  })

  it('round-trips through Date', () => {
    expect(fromDate(toDate('2026-08-26'))).toBe('2026-08-26')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('crosses a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01')
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
  })

  it('is unaffected by DST — these are calendar dates, not instants', () => {
    // US DST forward 2026-03-08, back 2026-11-01. Local-time math would drop or
    // duplicate a day here.
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09')
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02')
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })
})

describe('weekday', () => {
  it('uses ISO numbering, Monday = 1', () => {
    expect(weekday('2026-08-24')).toBe(1) // Monday
    expect(weekday('2026-08-26')).toBe(3) // Wednesday
    expect(weekday('2026-08-29')).toBe(6) // Saturday
    expect(weekday('2026-08-30')).toBe(7) // Sunday
  })

  it('identifies weekends', () => {
    expect(isWeekend('2026-08-28')).toBe(false)
    expect(isWeekend('2026-08-29')).toBe(true)
    expect(isWeekend('2026-08-30')).toBe(true)
  })
})

describe('weekOf', () => {
  it('matches the weeks drawn in the design mockup', () => {
    // The handoff screenshots show "W34 Aug 17-23" and "W35 Aug 24-30", with
    // Wed 26 Aug as today. Anything else means our week math is off by one.
    expect(weekOf('2026-08-26')).toBe('2026-W35')
    expect(weekStart('2026-W35')).toBe('2026-08-24')
    expect(weekEnd('2026-W35')).toBe('2026-08-30')
    expect(weekStart('2026-W34')).toBe('2026-08-17')
    expect(weekEnd('2026-W34')).toBe('2026-08-23')
  })

  it('assigns the year by Thursday, not by January 1', () => {
    // 2026-01-01 is a Thursday, so its week belongs to 2026 and starts in December.
    expect(weekOf('2026-01-01')).toBe('2026-W01')
    expect(weekOf('2025-12-29')).toBe('2026-W01')
    expect(weekStart('2026-W01')).toBe('2025-12-29')
  })

  it('handles a 53-week year', () => {
    // A year starting on Thursday has 53 ISO weeks.
    expect(weekOf('2026-12-31')).toBe('2026-W53')
    expect(weekOf('2027-01-01')).toBe('2026-W53')
    expect(isValidIsoWeek('2026-W53')).toBe(true)
  })

  it('rejects a 53rd week in a year that has none', () => {
    expect(isValidIsoWeek('2025-W53')).toBe(false)
    expect(isValidIsoWeek('2026-W54')).toBe(false)
    expect(isValidIsoWeek('2026-W00')).toBe(false)
    expect(isValidIsoWeek('2026-W5')).toBe(false)
  })

  it('round-trips every day of a week to the same week', () => {
    for (const d of allWeekDates('2026-W35')) expect(weekOf(d)).toBe('2026-W35')
  })
})

describe('week arithmetic', () => {
  it('adds and subtracts weeks across a year boundary', () => {
    expect(addWeeks('2026-W52', 1)).toBe('2026-W53')
    expect(addWeeks('2026-W53', 1)).toBe('2027-W01')
    expect(addWeeks('2027-W01', -1)).toBe('2026-W53')
  })

  it('measures whole weeks between', () => {
    expect(weeksBetween('2026-W34', '2026-W35')).toBe(1)
    expect(weeksBetween('2026-W35', '2026-W34')).toBe(-1)
    expect(weeksBetween('2026-W35', '2026-W35')).toBe(0)
    expect(weeksBetween('2026-W52', '2027-W01')).toBe(2)
  })

  it('builds an inclusive range', () => {
    expect(weekRange('2026-W34', '2026-W37')).toEqual([
      '2026-W34',
      '2026-W35',
      '2026-W36',
      '2026-W37',
    ])
    expect(weekRange('2026-W35', '2026-W35')).toEqual(['2026-W35'])
  })
})

describe('week day columns', () => {
  it('splits into the five weekday columns and the two-day weekend block', () => {
    expect(weekdayDates('2026-W35')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ])
    expect(weekendDates('2026-W35')).toEqual(['2026-08-29', '2026-08-30'])
    expect(allWeekDates('2026-W35')).toHaveLength(7)
  })
})
