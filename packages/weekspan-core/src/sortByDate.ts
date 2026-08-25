import type { IsoDate, Item, Weekspan } from './types.js'
import { getMark } from './marks.js'
import { effectiveMark, type VacationDays } from './derived.js'
import { rankSequence, siblingsOf } from './rank.js'
import { allWeekDates, weekOf } from './dates.js'

/**
 * One-shot reorder by date, for the sort button above the item column.
 *
 * The order is:
 *
 *   1. DONE items, by the latest date carrying a done mark
 *   2. DUE items, by their soonest due date
 *   3. everything with no mark at all, keeping their existing relative order
 *
 * Two judgment calls, stated because the brief did not pin them down and both
 * change the result:
 *
 * - **Direction is ascending in both buckets.** Oldest completion first, soonest
 *   due first. Soonest-first is the only ordering that makes the due bucket
 *   useful as a worklist, and matching it in the done bucket keeps the whole
 *   column reading as one timeline rather than two that meet in the middle.
 * - **A due item is keyed by its SOONEST due date, a done item by its LATEST
 *   done date.** They differ on purpose. "When must I next act on this" and
 *   "when did I last finish this" are the useful facts, and for an item chunked
 *   across several days they are opposite ends of the same range.
 *
 * Recurring items are keyed from the CURRENT WEEK only — their latest done, or
 * failing that their soonest occurrence, inside this week. A standing
 * commitment has no meaningful all-time date, and generated occurrences run to
 * the horizon in both directions, so any other window would sort them
 * arbitrarily.
 *
 * Ranks are sibling-scoped, so roots are sorted among roots and each parent's
 * children among themselves. Nesting survives the sort; a child never leaves
 * its parent.
 *
 * Returns `null` when the order is already correct, matching the no-op contract
 * used everywhere else — re-pressing the button on a sorted list writes nothing
 * and leaves no diff in a synced file.
 *
 * *Flagged:* unlike a drag, which rewrites one rank, this rewrites every rank
 * in a scope it reorders. That is inherent to sorting, and it is why this is an
 * explicit button rather than anything automatic.
 */

/** Bucket order. Lower sorts first. */
const DONE = 0
const DUE = 1
const NONE = 2

interface SortKey {
  bucket: number
  /** ISO date within the bucket; `''` for the unmarked bucket. */
  date: string
  /** Original position, so the sort is stable and unmarked items keep their order. */
  index: number
}

function keyForRecurring(item: Item, today: IsoDate, vacationDays: VacationDays): { bucket: number; date: string } {
  // All seven days, not just weekdays: a recurring rule can fire on a weekend,
  // and close-out already treats those as real.
  let latestDone = ''
  let soonestDue = ''
  for (const date of allWeekDates(weekOf(today))) {
    const mark = effectiveMark(item, date, vacationDays)
    if (!mark) continue
    if (mark.kind === 'done' && date > latestDone) latestDone = date
    if (mark.kind === 'due' && (soonestDue === '' || date < soonestDue)) soonestDue = date
  }

  if (latestDone !== '') return { bucket: DONE, date: latestDone }
  if (soonestDue !== '') return { bucket: DUE, date: soonestDue }
  return { bucket: NONE, date: '' }
}

function keyForPlain(item: Item): { bucket: number; date: string } {
  let latestDone = ''
  let soonestDue = ''
  for (const date of Object.keys(item.marks)) {
    const mark = getMark(item, date)
    if (!mark) continue
    if (mark.kind === 'done' && date > latestDone) latestDone = date
    if (mark.kind === 'due' && (soonestDue === '' || date < soonestDue)) soonestDue = date
  }

  // Done wins over a stale due, matching `isFinished`: a completed item is not
  // dragged back into the worklist by an earlier plan to do it.
  if (latestDone !== '') return { bucket: DONE, date: latestDone }
  if (soonestDue !== '') return { bucket: DUE, date: soonestDue }
  return { bucket: NONE, date: '' }
}

/** The sort key for one item. Exported for tests and for a UI that wants to explain the order. */
export function sortKeyFor(
  item: Item,
  today: IsoDate,
  vacationDays: VacationDays,
  index = 0,
): SortKey {
  const { bucket, date } = item.recurrence
    ? keyForRecurring(item, today, vacationDays)
    : keyForPlain(item)
  return { bucket, date, index }
}

function compare(a: SortKey, b: SortKey): number {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket
  // Unmarked items have no date; fall through to the stable tiebreak.
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.index - b.index
}

export function sortByDate(weekspan: Weekspan, today: IsoDate): Weekspan | null {
  const scopes: Array<string | null> = [null]
  for (const item of weekspan.items) {
    if (item.parentId != null && !scopes.includes(item.parentId)) scopes.push(item.parentId)
  }

  const newRankById = new Map<string, string>()
  let changed = false

  for (const parentId of scopes) {
    const scope = siblingsOf(weekspan.items, parentId)
    if (scope.length < 2) continue

    const keyed = scope.map((item, index) => ({
      item,
      key: sortKeyFor(item, today, weekspan.vacationDays, index),
    }))
    const sorted = [...keyed].sort((a, b) => compare(a.key, b.key))

    if (sorted.some((entry, i) => entry.item.id !== scope[i]!.id)) changed = true

    const ranks = rankSequence(sorted.length)
    sorted.forEach((entry, i) => newRankById.set(entry.item.id, ranks[i]!))
  }

  if (!changed) return null

  return {
    ...weekspan,
    items: weekspan.items.map((item) => {
      const rank = newRankById.get(item.id)
      return rank === undefined || rank === item.rank ? item : { ...item, rank }
    }),
  }
}
