import { addDays, isValidIsoDate, weekday } from '@murch-todo/ledger-core'
import type { IsoDate } from '@murch-todo/ledger-core'
import { CliError, EXIT } from './exit.js'

/**
 * Turns a user/agent-supplied date argument into an `IsoDate`.
 *
 * `today` is always passed in, never read from the clock — no `new Date()`
 * anywhere in this module — so every form below is deterministically testable,
 * mirroring how every date-dependent function in ledger-core takes `today` as
 * a parameter rather than reaching for the system clock.
 *
 * Accepted forms:
 *   - ISO:            `2026-08-27`
 *   - keywords:        today, tomorrow, yesterday
 *   - weekday names:   mon..sun / monday..sunday, case-insensitive, resolves
 *                       to the NEXT such weekday at or after `today` (today
 *                       itself counts)
 *   - relative offset: `+3d`, `-1w`, `+2w`, `-5d` (days/weeks only, sign required)
 *
 * Anything else throws. This module never guesses: a silently-wrong date is
 * worse than a loud failure, because nothing downstream can detect it.
 */

const WEEKDAY_NAMES: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
}

const OFFSET_RE = /^([+-])(\d+)([dw])$/

const ACCEPTED_FORMS =
  'accepted forms: ISO date (YYYY-MM-DD), keyword (today/tomorrow/yesterday), ' +
  'weekday name (mon..sun or monday..sunday), or relative offset (+3d, -1w)'

export function parseDateArg(input: string, today: IsoDate): IsoDate {
  const result = tryParseDateArg(input, today)
  if (result === undefined) {
    throw new CliError(`Unrecognized date argument: ${JSON.stringify(input)} (${ACCEPTED_FORMS})`, EXIT.USAGE)
  }
  return result
}

export function tryParseDateArg(input: string, today: IsoDate): IsoDate | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined
  // Reject inputs with internal whitespace too ("next thursday").
  if (trimmed !== input || /\s/.test(trimmed)) return undefined

  if (isValidIsoDate(trimmed)) {
    // isValidIsoDate accepts only strict YYYY-MM-DD (validated via toDate's
    // round-trip), so no separate padding/format check is needed here.
    return trimmed
  }

  const lower = trimmed.toLowerCase()
  if (lower === 'today') return today
  if (lower === 'tomorrow') return addDays(today, 1)
  if (lower === 'yesterday') return addDays(today, -1)

  if (lower in WEEKDAY_NAMES) {
    return nextWeekdayInclusive(today, WEEKDAY_NAMES[lower]!)
  }

  const m = OFFSET_RE.exec(trimmed)
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    const n = Number(m[2])
    const unit = m[3]
    const days = unit === 'w' ? n * 7 : n
    return addDays(today, sign * days)
  }

  return undefined
}

/** Next date on-or-after `today` (inclusive) whose weekday matches `targetWeekday` (1=Mon..7=Sun). */
function nextWeekdayInclusive(today: IsoDate, targetWeekday: number): IsoDate {
  const delta = (targetWeekday - weekday(today) + 7) % 7
  return addDays(today, delta)
}
