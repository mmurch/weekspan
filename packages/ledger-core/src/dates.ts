import type { IsoDate, IsoWeek } from './types.js'

/**
 * Calendar-date and ISO-week arithmetic.
 *
 * Everything is computed in UTC. These are calendar dates with no time-of-day,
 * so using local time would make `addDays` wrong across DST boundaries and make
 * week membership depend on the user's timezone.
 *
 * Both `IsoDate` and `IsoWeek` are zero-padded, so lexicographic string compare
 * is also chronological compare. Callers rely on that.
 */

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEK_RE = /^(\d{4})-W(\d{2})$/

/** Parse `YYYY-MM-DD` to a UTC Date, rejecting non-dates like `2026-02-30`. */
export function toDate(iso: IsoDate): Date {
  const m = DATE_RE.exec(iso)
  if (!m) throw new Error(`Invalid IsoDate: ${JSON.stringify(iso)} (expected YYYY-MM-DD)`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  // Date.UTC silently rolls over (Feb 30 -> Mar 2); round-trip to catch it.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid IsoDate: ${JSON.stringify(iso)} (no such calendar date)`)
  }
  return dt
}

export function fromDate(dt: Date): IsoDate {
  const y = String(dt.getUTCFullYear()).padStart(4, '0')
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isValidIsoDate(iso: string): boolean {
  try {
    toDate(iso)
    return true
  } catch {
    return false
  }
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  return fromDate(new Date(toDate(iso).getTime() + n * DAY_MS))
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS)
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. (JS `getUTCDay()` is 0 = Sunday.) */
export function weekday(iso: IsoDate): number {
  return ((toDate(iso).getUTCDay() + 6) % 7) + 1
}

/** The ISO week a date falls in. Week 1 is the week containing the first Thursday. */
export function weekOf(iso: IsoDate): IsoWeek {
  const dt = toDate(iso)
  // Thursday of this week decides which year (and therefore which week) owns it.
  const thursday = new Date(dt.getTime() + (4 - weekday(iso)) * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - week1Monday(year).getTime()) / WEEK_MS) + 1
  return `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}`
}

/** Monday of ISO week 1 of `year` — the week containing Jan 4, by definition. */
function week1Monday(year: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = ((jan4.getUTCDay() + 6) % 7) + 1
  return new Date(jan4.getTime() - (dow - 1) * DAY_MS)
}

function parseWeek(week: IsoWeek): { year: number; week: number } {
  const m = WEEK_RE.exec(week)
  if (!m) throw new Error(`Invalid IsoWeek: ${JSON.stringify(week)} (expected YYYY-Www)`)
  const year = Number(m[1])
  const w = Number(m[2])
  if (w < 1 || w > 53) throw new Error(`Invalid IsoWeek: ${JSON.stringify(week)} (week out of range)`)
  return { year, week: w }
}

export function isValidIsoWeek(week: string): boolean {
  try {
    const { year, week: w } = parseWeek(week)
    // 53 only exists in long years; verify by round-tripping the Monday.
    return weekOf(fromDate(new Date(week1Monday(year).getTime() + (w - 1) * WEEK_MS))) === week
  } catch {
    return false
  }
}

/** Monday of the given week. */
export function weekStart(week: IsoWeek): IsoDate {
  const { year, week: w } = parseWeek(week)
  return fromDate(new Date(week1Monday(year).getTime() + (w - 1) * WEEK_MS))
}

/** Sunday of the given week. */
export function weekEnd(week: IsoWeek): IsoDate {
  return addDays(weekStart(week), 6)
}

export function addWeeks(week: IsoWeek, n: number): IsoWeek {
  return weekOf(addDays(weekStart(week), n * 7))
}

/** Whole-week difference, `b - a`. */
export function weeksBetween(a: IsoWeek, b: IsoWeek): number {
  return Math.round(daysBetween(weekStart(a), weekStart(b)) / 7)
}

/** Mon..Fri — the five columns the grid draws inside a week block. */
export function weekdayDates(week: IsoWeek): IsoDate[] {
  const mon = weekStart(week)
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i))
}

/** Sat, Sun — the narrow block that belongs to neither adjacent week. */
export function weekendDates(week: IsoWeek): IsoDate[] {
  const mon = weekStart(week)
  return [5, 6].map((i) => addDays(mon, i))
}

/** All seven days, Mon..Sun. */
export function allWeekDates(week: IsoWeek): IsoDate[] {
  const mon = weekStart(week)
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i))
}

export function isWeekend(iso: IsoDate): boolean {
  return weekday(iso) >= 6
}

/** Inclusive range of weeks. */
export function weekRange(from: IsoWeek, to: IsoWeek): IsoWeek[] {
  const out: IsoWeek[] = []
  const n = weeksBetween(from, to)
  for (let i = 0; i <= n; i++) out.push(addWeeks(from, i))
  return out
}
