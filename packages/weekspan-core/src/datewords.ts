import type { IsoDate } from './types.js'
import { addDays, isValidIsoDate, weekday } from './dates.js'

/**
 * Turns a user/agent-supplied "date word" into an `IsoDate`.
 *
 * `today` is always passed in, never read from the clock — no `new Date()`
 * anywhere in this module — so every form below is deterministically testable,
 * mirroring every other date-dependent function in weekspan-core.
 *
 * This is the ONE vocabulary shared by the CLI (`parseDateArg`, an agent typing
 * `thu`) and the web quick-capture (`parseCapture`, a person typing `thu`).
 * Both wrap this module rather than reimplementing it, so the two surfaces can
 * never drift apart on what a word like `thu` or `+3d` means.
 *
 * Accepted forms:
 *   - ISO:            `2026-08-27`
 *   - keywords:        today, tomorrow, yesterday
 *   - weekday names:   mon..sun / monday..sunday, case-insensitive, resolves
 *                       to the NEXT such weekday at or after `today` (today
 *                       itself counts)
 *   - relative offset: `+3d`, `-1w`, `+2w`, `-5d` (days/weeks only, sign required)
 *
 * Anything else fails to parse. This module never guesses: a silently-wrong
 * date is worse than a loud failure, because nothing downstream can detect it.
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

/**
 * Parse `input` as a date word. Returns `undefined` (never throws) if it
 * doesn't match any accepted form.
 */
export function tryParseDateWord(input: string, today: IsoDate): IsoDate | undefined {
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

/**
 * Parse `input` as a date word, throwing a plain `Error` (never a
 * package-specific error type — this module has no dependency on the CLI or
 * the web app) naming the offending input and the accepted forms.
 */
export function parseDateWord(input: string, today: IsoDate): IsoDate {
  const result = tryParseDateWord(input, today)
  if (result === undefined) {
    throw new Error(`Unrecognized date argument: ${JSON.stringify(input)} (${ACCEPTED_FORMS})`)
  }
  return result
}

/** Next date on-or-after `today` (inclusive) whose weekday matches `targetWeekday` (1=Mon..7=Sun). */
function nextWeekdayInclusive(today: IsoDate, targetWeekday: number): IsoDate {
  const delta = (targetWeekday - weekday(today) + 7) % 7
  return addDays(today, delta)
}
