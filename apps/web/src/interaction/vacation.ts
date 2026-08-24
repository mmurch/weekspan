/**
 * Vacation-day toggling — clicking a date header (design_handoff_todo_ledger/
 * README.md, "Vacation days" and `#3d`).
 *
 * Marking a day vacation is not just a flag flip: "anything already due there
 * shifts to the next working day." This module owns that shift, in addition
 * to the toggle itself, so `keymap.ts`'s per-cell due/done refusal and this
 * module's per-day rescheduling can never drift apart — both read the same
 * `weekspan.vacationDays` array, and only this module ever writes to it.
 *
 * Follows the house pattern for pure mutations (see `marks.ts`): every
 * function here is pure, the input `Weekspan` is never mutated, and
 * `toggleVacation` returns `null` on a no-op so callers can feed it straight
 * into `mutate(apply)` the way every other write path in this app does.
 */

import type { IsoDate, Weekspan } from '@weekspan/weekspan-core'
import { addDays, isWeekend } from '@weekspan/weekspan-core'

export interface VacationChange {
  weekspan: Weekspan
  /** Ids of items whose `due` mark was moved off the newly-vacation day, so the UI can say so. */
  movedItemIds: string[]
}

/**
 * `nextWorkingDay` walks forward from (not including) `from` looking for a
 * date that is neither a weekend nor another vacation day.
 *
 * Capped at a year of lookahead so a long or unbounded run of vacation days
 * (someone marking out an entire year, or a future bug that does the same)
 * cannot turn this into an infinite loop. If nothing in that window
 * qualifies, this falls back to the literal next calendar day — still
 * blocked, but a deterministic, terminating answer beats hanging or
 * guessing arbitrarily far into the future.
 */
const MAX_SEARCH_DAYS = 365

export function nextWorkingDay(weekspan: Weekspan, from: IsoDate): IsoDate {
  for (let i = 1; i <= MAX_SEARCH_DAYS; i++) {
    const candidate = addDays(from, i)
    if (!isWeekend(candidate) && !weekspan.vacationDays.includes(candidate)) {
      return candidate
    }
  }
  return addDays(from, 1)
}

/** Whether `date` is currently marked vacation on `weekspan`. */
export function isVacation(weekspan: Weekspan, date: IsoDate): boolean {
  return weekspan.vacationDays.includes(date)
}

/**
 * Toggle vacation status on `date`.
 *
 * Turning a day ON shifts every explicit `due` mark sitting on it to
 * `nextWorkingDay` and reports which items moved, so the UI can surface that
 * — silently rescheduling someone's work is alarming when they notice later.
 * `done` and `skip` marks are left exactly where they are: a completion (or a
 * skip) is a historical fact about a day that already happened, and moving it
 * would falsify the record. Only future intent (`due`) shifts.
 *
 * If an item already has some other mark sitting on the destination day, that
 * mark is REPLACED by the incoming due — this module enforces the same
 * "at most one mark per (item, date)" invariant `setMark` does, and a move is
 * exactly a delete-then-set on one item's own marks map.
 *
 * Turning a day OFF (un-marking) does NOT move anything back. The shift
 * already happened as a real, visible edit, and the user may have since
 * adjusted things around it — silently reversing it would be a second
 * unrequested change stacked on the first. This asymmetry is deliberate, not
 * an oversight: "on" has a rescheduling side effect, "off" is just removing a
 * flag.
 *
 * `today` is accepted for the same reason every date-dependent function in
 * `@weekspan/weekspan-core` takes it explicitly, even though today's rule
 * happens not to branch on it (mirrors `nextMarkState` in `cycle.ts`) — a
 * future rule that depends on the clock (e.g. refusing to toggle a day far in
 * the past) can add that check here without changing any call site.
 *
 * A toggle always changes `vacationDays` by definition, so this never
 * actually returns `null` today; the `| null` return stays in the signature
 * to match the `mutate(apply)` contract every other write in this app uses.
 */
export function toggleVacation(
  weekspan: Weekspan,
  date: IsoDate,
  today: IsoDate,
): VacationChange | null {
  void today // reserved — see doc comment above.

  if (weekspan.vacationDays.includes(date)) {
    // Turning OFF. No un-shift — see doc comment above.
    const vacationDays = weekspan.vacationDays.filter((d) => d !== date)
    return { weekspan: { ...weekspan, vacationDays }, movedItemIds: [] }
  }

  // Turning ON. `vacationDays` must include `date` BEFORE we compute
  // destinations, so a run of consecutive newly-marked days (this call marks
  // only one, but the destination search still needs to see it) is never
  // offered as a landing spot for its own due marks.
  const vacationDays = [...weekspan.vacationDays, date].sort()
  const withVacationDay: Weekspan = { ...weekspan, vacationDays }

  const movedItemIds: string[] = []
  const items = withVacationDay.items.map((item) => {
    const mark = item.marks[date]
    if (!mark || mark.kind !== 'due') return item

    const destination = nextWorkingDay(withVacationDay, date)
    const marks = { ...item.marks }
    delete marks[date]
    marks[destination] = { kind: 'due' }
    movedItemIds.push(item.id)
    return { ...item, marks }
  })

  return { weekspan: { ...withVacationDay, items }, movedItemIds }
}
