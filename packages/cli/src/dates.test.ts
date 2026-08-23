import type { IsoDate } from '@weekspan/weekspan-core'
import { CliError, EXIT } from './exit.js'
import { parseDateArg, tryParseDateArg } from './dates.js'

// Wednesday.
const TODAY: IsoDate = '2026-08-26'

describe('parseDateArg — ISO form', () => {
  it('accepts a well-formed ISO date', () => {
    expect(parseDateArg('2026-08-27', TODAY)).toBe('2026-08-27')
  })

  it('rejects an impossible calendar date', () => {
    expect(() => parseDateArg('2026-02-30', TODAY)).toThrow(CliError)
    try {
      parseDateArg('2026-02-30', TODAY)
    } catch (e) {
      expect((e as CliError).code).toBe(EXIT.USAGE)
    }
  })

  it('rejects unpadded ISO dates', () => {
    expect(() => parseDateArg('2026-8-27', TODAY)).toThrow(CliError)
  })

  it('rejects slash-delimited dates', () => {
    expect(() => parseDateArg('27/08/2026', TODAY)).toThrow(CliError)
  })
})

describe('parseDateArg — keywords', () => {
  it('resolves today', () => {
    expect(parseDateArg('today', TODAY)).toBe('2026-08-26')
  })

  it('resolves tomorrow', () => {
    expect(parseDateArg('tomorrow', TODAY)).toBe('2026-08-27')
  })

  it('resolves yesterday', () => {
    expect(parseDateArg('yesterday', TODAY)).toBe('2026-08-25')
  })

  it('is case-insensitive', () => {
    expect(parseDateArg('TODAY', TODAY)).toBe('2026-08-26')
    expect(parseDateArg('Tomorrow', TODAY)).toBe('2026-08-27')
  })
})

describe('parseDateArg — weekday names', () => {
  it('resolves each weekday abbreviation and full name to the same date', () => {
    const pairs: Array<[string, string]> = [
      ['mon', 'monday'],
      ['tue', 'tuesday'],
      ['wed', 'wednesday'],
      ['thu', 'thursday'],
      ['fri', 'friday'],
      ['sat', 'saturday'],
      ['sun', 'sunday'],
    ]
    for (const [abbr, full] of pairs) {
      expect(parseDateArg(abbr, TODAY)).toBe(parseDateArg(full, TODAY))
    }
  })

  it('is case-insensitive and full/abbreviated forms agree', () => {
    expect(parseDateArg('THU', TODAY)).toBe(parseDateArg('thu', TODAY))
    expect(parseDateArg('thu', TODAY)).toBe(parseDateArg('thursday', TODAY))
  })

  it('is inclusive: today (Wednesday) for "wed" resolves to today, not next week', () => {
    expect(parseDateArg('wed', TODAY)).toBe('2026-08-26')
  })

  it('resolves "tue" (a day that already passed this week) to next week, not yesterday', () => {
    expect(parseDateArg('tue', TODAY)).toBe('2026-09-01')
  })

  it('resolves a weekday later in the same week normally', () => {
    // Wednesday -> Friday is 2 days out.
    expect(parseDateArg('fri', TODAY)).toBe('2026-08-28')
  })

  it('resolves weekday names crossing a month boundary', () => {
    // Wed 2026-08-26 -> next Tue crosses into September.
    expect(parseDateArg('tue', TODAY)).toBe('2026-09-01')
  })

  it('resolves weekday names crossing a year boundary', () => {
    // Wed 2026-12-30 -> next Mon is 2027-01-04.
    expect(parseDateArg('mon', '2026-12-30')).toBe('2027-01-04')
  })
})

describe('parseDateArg — relative offsets', () => {
  it('adds days with +Nd', () => {
    expect(parseDateArg('+3d', TODAY)).toBe('2026-08-29')
  })

  it('subtracts days with -Nd', () => {
    expect(parseDateArg('-5d', TODAY)).toBe('2026-08-21')
  })

  it('adds weeks with +Nw', () => {
    expect(parseDateArg('+2w', TODAY)).toBe('2026-09-09')
  })

  it('subtracts weeks with -Nw', () => {
    expect(parseDateArg('-1w', TODAY)).toBe('2026-08-19')
  })

  it('handles offsets crossing a month boundary', () => {
    expect(parseDateArg('+3d', '2026-08-30')).toBe('2026-09-02')
  })
})

describe('parseDateArg — rejections', () => {
  const rejects = ['', '   ', '2026-8-27', '27/08/2026', 'next thursday', '3d', '+3', '+3m', 't', 's']

  it.each(rejects)('rejects %j with CliError(EXIT.USAGE)', (input) => {
    expect(() => parseDateArg(input, TODAY)).toThrow(CliError)
    try {
      parseDateArg(input, TODAY)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CliError)
      expect((e as CliError).code).toBe(EXIT.USAGE)
    }
  })

  it('names the offending input and lists accepted forms in the error message', () => {
    try {
      parseDateArg('bogus', TODAY)
      expect.unreachable()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('bogus')
      expect(msg.toLowerCase()).toContain('accepted forms')
    }
  })
})

describe('tryParseDateArg', () => {
  it('returns the parsed date for valid input', () => {
    expect(tryParseDateArg('2026-08-27', TODAY)).toBe('2026-08-27')
    expect(tryParseDateArg('tomorrow', TODAY)).toBe('2026-08-27')
    expect(tryParseDateArg('thu', TODAY)).toBe('2026-08-27')
    expect(tryParseDateArg('+1d', TODAY)).toBe('2026-08-27')
  })

  it('returns undefined instead of throwing for invalid input', () => {
    expect(tryParseDateArg('not-a-date', TODAY)).toBeUndefined()
    expect(tryParseDateArg('', TODAY)).toBeUndefined()
    expect(tryParseDateArg('t', TODAY)).toBeUndefined()
    expect(tryParseDateArg('2026-02-30', TODAY)).toBeUndefined()
  })
})
