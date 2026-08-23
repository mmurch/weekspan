import type { IsoDate, Recurrence } from './types.js'
import {
  addDays,
  addWeeks,
  isValidIsoDate,
  weekday,
  weekOf,
  weekStart,
  weekEnd,
  weeksBetween,
} from './dates.js'

/**
 * Recurrence: expand a stored rule into occurrences at read time.
 *
 * The ledger never persists generated occurrences — only the rule (`Recurrence`)
 * lives in the file, plus whatever exceptions (done/skip/due marks) the user has
 * made. Every function here is pure and re-derives occurrences from the rule on
 * every call; nothing here mutates or caches into the ledger.
 */

/** Throw a clear error if `rule` is not a well-formed recurrence. */
export function validateRecurrence(rule: Recurrence): void {
  if (!isValidIsoDate(rule.anchor)) {
    throw new Error(`Recurrence.anchor is not a valid IsoDate: ${JSON.stringify(rule.anchor)}`)
  }

  if (rule.until !== undefined) {
    if (!isValidIsoDate(rule.until)) {
      throw new Error(`Recurrence.until is not a valid IsoDate: ${JSON.stringify(rule.until)}`)
    }
    if (rule.until < rule.anchor) {
      throw new Error(
        `Recurrence.until (${rule.until}) must not be before anchor (${rule.anchor})`,
      )
    }
  }

  switch (rule.freq) {
    case 'weekly':
    case 'biweekly':
      if (
        rule.weekday === undefined ||
        !Number.isInteger(rule.weekday) ||
        rule.weekday < 1 ||
        rule.weekday > 7
      ) {
        throw new Error(
          `Recurrence.weekday must be an integer in 1..7 for freq ${JSON.stringify(rule.freq)}, got ${JSON.stringify(rule.weekday)}`,
        )
      }
      break
    case 'monthly':
      if (
        rule.monthday === undefined ||
        !Number.isInteger(rule.monthday) ||
        rule.monthday < 1 ||
        rule.monthday > 31
      ) {
        throw new Error(
          `Recurrence.monthday must be an integer in 1..31 for freq "monthly", got ${JSON.stringify(rule.monthday)}`,
        )
      }
      break
    default:
      throw new Error(`Recurrence.freq is not a recognized frequency: ${JSON.stringify((rule as Recurrence).freq)}`)
  }
}

/** True if `rule`'s anchor-week is the "on" fortnight for the ISO week containing `date`. */
function isOnFortnight(rule: Recurrence, date: IsoDate): boolean {
  const anchorWeek = weekOf(rule.anchor)
  const dateWeek = weekOf(date)
  const delta = weeksBetween(anchorWeek, dateWeek)
  // weeksBetween can be negative (date before anchor); normalize before checking parity.
  return ((delta % 2) + 2) % 2 === 0
}

/** The `monthday`-th of the given date's month, or undefined if that month is too short. */
function monthlyOccurrenceInMonthOf(date: IsoDate, monthday: number): IsoDate | undefined {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (monthday > daysInMonth) return undefined
  return `${date.slice(0, 7)}-${String(monthday).padStart(2, '0')}`
}

/** Single-date occurrence test, consistent with `occurrencesIn`. */
export function occursOn(rule: Recurrence, date: IsoDate): boolean {
  if (date < rule.anchor) return false
  if (rule.until !== undefined && date > rule.until) return false

  switch (rule.freq) {
    case 'weekly':
      return weekday(date) === rule.weekday
    case 'biweekly':
      return weekday(date) === rule.weekday && isOnFortnight(rule, date)
    case 'monthly': {
      const occ = monthlyOccurrenceInMonthOf(date, rule.monthday!)
      return occ === date
    }
    default:
      return false
  }
}

/**
 * All occurrences of `rule` in `[from, to]`, inclusive both ends, ascending, deduped.
 * Clamped so nothing is generated before `rule.anchor` or after `rule.until`.
 */
export function occurrencesIn(rule: Recurrence, from: IsoDate, to: IsoDate): IsoDate[] {
  if (to < from) return []

  const lo = from < rule.anchor ? rule.anchor : from
  const hi = rule.until !== undefined && rule.until < to ? rule.until : to
  if (hi < lo) return []

  const out: IsoDate[] = []

  switch (rule.freq) {
    case 'weekly':
    case 'biweekly': {
      // Find the first date >= lo that falls on rule.weekday.
      const loWeekday = weekday(lo)
      let offset = rule.weekday! - loWeekday
      if (offset < 0) offset += 7
      let cursor = addDays(lo, offset)
      const step = rule.freq === 'weekly' ? 7 : 14
      if (rule.freq === 'biweekly') {
        // cursor is on the right weekday but maybe the wrong fortnight; nudge by one week if so.
        if (!isOnFortnight(rule, cursor)) cursor = addDays(cursor, 7)
      }
      while (cursor <= hi) {
        out.push(cursor)
        cursor = addDays(cursor, step)
      }
      break
    }
    case 'monthly': {
      // Walk month-by-month from lo's month through hi's month.
      let y = Number(lo.slice(0, 4))
      let m = Number(lo.slice(5, 7))
      const hiY = Number(hi.slice(0, 4))
      const hiM = Number(hi.slice(5, 7))
      while (y < hiY || (y === hiY && m <= hiM)) {
        const monthStart = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
        const occ = monthlyOccurrenceInMonthOf(monthStart, rule.monthday!)
        if (occ !== undefined && occ >= lo && occ <= hi) out.push(occ)
        m += 1
        if (m > 12) {
          m = 1
          y += 1
        }
      }
      break
    }
  }

  return out
}

/** First occurrence strictly after `after`, or undefined if the series has ended. */
export function nextOccurrence(rule: Recurrence, after: IsoDate): IsoDate | undefined {
  const searchFrom = addDays(after, 1)
  const hi = rule.until !== undefined ? rule.until : addDays(searchFrom, 400)
  if (searchFrom > hi) return undefined
  const found = occurrencesIn(rule, searchFrom, hi)
  return found[0]
}

/**
 * The period the rule itself defines around `today`: a week for `weekly`, a
 * fortnight (aligned to the anchor's phase) for `biweekly`, a calendar month
 * for `monthly`. Used so a recurring item appears finished for the rest of its
 * own period once its occurrence is marked done, rather than going pending
 * again at the next calendar week boundary.
 */
export function currentPeriod(rule: Recurrence, today: IsoDate): { from: IsoDate; to: IsoDate } {
  switch (rule.freq) {
    case 'weekly': {
      const w = weekOf(today)
      return { from: weekStart(w), to: weekEnd(w) }
    }
    case 'biweekly': {
      const w = weekOf(today)
      // Snap to the start of the current "on" fortnight: if this week is off-phase,
      // the fortnight started the previous week.
      const start = isOnFortnight(rule, today) ? w : addWeeks(w, -1)
      return { from: weekStart(start), to: weekEnd(addWeeks(start, 1)) }
    }
    case 'monthly': {
      const y = today.slice(0, 4)
      const m = today.slice(5, 7)
      const from = `${y}-${m}-01`
      const daysInMonth = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate()
      const to = `${y}-${m}-${String(daysInMonth).padStart(2, '0')}`
      return { from, to }
    }
    default:
      throw new Error(`Unrecognized Recurrence.freq: ${JSON.stringify((rule as Recurrence).freq)}`)
  }
}
