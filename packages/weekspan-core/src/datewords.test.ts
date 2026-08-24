import type { IsoDate } from './types.js'
import { parseDateWord, tryParseDateWord } from './datewords.js'

// Wednesday.
const TODAY: IsoDate = '2026-08-26'

describe('parseDateWord — ISO form', () => {
  it('accepts a well-formed ISO date', () => {
    expect(parseDateWord('2026-08-27', TODAY)).toBe('2026-08-27')
  })

  it('rejects an impossible calendar date', () => {
    expect(() => parseDateWord('2026-02-30', TODAY)).toThrow(Error)
    try {
      parseDateWord('2026-02-30', TODAY)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  it('rejects unpadded ISO dates', () => {
    expect(() => parseDateWord('2026-8-27', TODAY)).toThrow(Error)
  })

  it('rejects slash-delimited dates', () => {
    expect(() => parseDateWord('27/08/2026', TODAY)).toThrow(Error)
  })
})

describe('parseDateWord — keywords', () => {
  it('resolves today', () => {
    expect(parseDateWord('today', TODAY)).toBe('2026-08-26')
  })

  it('resolves tomorrow', () => {
    expect(parseDateWord('tomorrow', TODAY)).toBe('2026-08-27')
  })

  it('resolves yesterday', () => {
    expect(parseDateWord('yesterday', TODAY)).toBe('2026-08-25')
  })

  it('is case-insensitive', () => {
    expect(parseDateWord('TODAY', TODAY)).toBe('2026-08-26')
    expect(parseDateWord('Tomorrow', TODAY)).toBe('2026-08-27')
  })
})

describe('parseDateWord — weekday names', () => {
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
      expect(parseDateWord(abbr, TODAY)).toBe(parseDateWord(full, TODAY))
    }
  })

  it('is case-insensitive and full/abbreviated forms agree', () => {
    expect(parseDateWord('THU', TODAY)).toBe(parseDateWord('thu', TODAY))
    expect(parseDateWord('thu', TODAY)).toBe(parseDateWord('thursday', TODAY))
  })

  it('is inclusive: today (Wednesday) for "wed" resolves to today, not next week', () => {
    expect(parseDateWord('wed', TODAY)).toBe('2026-08-26')
  })

  it('resolves "tue" (a day that already passed this week) to next week, not yesterday', () => {
    expect(parseDateWord('tue', TODAY)).toBe('2026-09-01')
  })

  it('resolves a weekday later in the same week normally', () => {
    // Wednesday -> Friday is 2 days out.
    expect(parseDateWord('fri', TODAY)).toBe('2026-08-28')
  })

  it('resolves weekday names crossing a month boundary', () => {
    // Wed 2026-08-26 -> next Tue crosses into September.
    expect(parseDateWord('tue', TODAY)).toBe('2026-09-01')
  })

  it('resolves weekday names crossing a year boundary', () => {
    // Wed 2026-12-30 -> next Mon is 2027-01-04.
    expect(parseDateWord('mon', '2026-12-30')).toBe('2027-01-04')
  })
})

describe('parseDateWord — relative offsets', () => {
  it('adds days with +Nd', () => {
    expect(parseDateWord('+3d', TODAY)).toBe('2026-08-29')
  })

  it('subtracts days with -Nd', () => {
    expect(parseDateWord('-5d', TODAY)).toBe('2026-08-21')
  })

  it('adds weeks with +Nw', () => {
    expect(parseDateWord('+2w', TODAY)).toBe('2026-09-09')
  })

  it('subtracts weeks with -Nw', () => {
    expect(parseDateWord('-1w', TODAY)).toBe('2026-08-19')
  })

  it('handles offsets crossing a month boundary', () => {
    expect(parseDateWord('+3d', '2026-08-30')).toBe('2026-09-02')
  })
})

describe('parseDateWord — rejections', () => {
  const rejects = ['', '   ', '2026-8-27', '27/08/2026', 'next thursday', '3d', '+3', '+3m', 't', 's']

  it.each(rejects)('rejects %j with a plain Error', (input) => {
    expect(() => parseDateWord(input, TODAY)).toThrow(Error)
    try {
      parseDateWord(input, TODAY)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  it('names the offending input and lists accepted forms in the error message', () => {
    try {
      parseDateWord('bogus', TODAY)
      expect.unreachable()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('bogus')
      expect(msg.toLowerCase()).toContain('accepted forms')
    }
  })
})

describe('tryParseDateWord', () => {
  it('returns the parsed date for valid input', () => {
    expect(tryParseDateWord('2026-08-27', TODAY)).toBe('2026-08-27')
    expect(tryParseDateWord('tomorrow', TODAY)).toBe('2026-08-27')
    expect(tryParseDateWord('thu', TODAY)).toBe('2026-08-27')
    expect(tryParseDateWord('+1d', TODAY)).toBe('2026-08-27')
  })

  it('returns undefined instead of throwing for invalid input', () => {
    expect(tryParseDateWord('not-a-date', TODAY)).toBeUndefined()
    expect(tryParseDateWord('', TODAY)).toBeUndefined()
    expect(tryParseDateWord('t', TODAY)).toBeUndefined()
    expect(tryParseDateWord('2026-02-30', TODAY)).toBeUndefined()
  })
})

describe('parity: one vocabulary shared by the CLI and web quick-capture', () => {
  // Fixed `today` distinct from the suite above, so this table stands on its
  // own as the parity proof the consolidation is about: every accepted word
  // resolves to exactly one date, and every rejected word is rejected, from a
  // single shared implementation — not two hand-synced copies.
  const PARITY_TODAY: IsoDate = '2026-08-24' // Monday

  const accepted: Array<[input: string, expected: IsoDate]> = [
    ['thu', '2026-08-27'],
    ['THURSDAY', '2026-08-27'],
    ['thursday', '2026-08-27'],
    ['today', '2026-08-24'],
    ['tomorrow', '2026-08-25'],
    ['yesterday', '2026-08-23'],
    ['mon', '2026-08-24'], // inclusive: today is Monday
    ['+3d', '2026-08-27'],
    ['-1w', '2026-08-17'],
    ['+2w', '2026-09-07'],
    ['2026-08-27', '2026-08-27'],
  ]

  it.each(accepted)('resolves %j to %j', (input, expected) => {
    expect(tryParseDateWord(input, PARITY_TODAY)).toBe(expected)
    expect(parseDateWord(input, PARITY_TODAY)).toBe(expected)
  })

  const rejected = ['2026-8-27', '2026-02-30', '27/08/2026', 'next thursday', '3d', '+3', '+3m', 't', 's', '']

  it.each(rejected)('rejects %j', (input) => {
    expect(tryParseDateWord(input, PARITY_TODAY)).toBeUndefined()
    expect(() => parseDateWord(input, PARITY_TODAY)).toThrow(Error)
  })
})
