import type { IsoDate, Item, Weekspan } from './types.js'
import { effectiveMark, type VacationDays } from './derived.js'
import { allWeekDates, weekOf } from './dates.js'
import { orderItems } from './rank.js'

/**
 * Remove an item, and its children with it.
 *
 * The cascade is not a convenience — it is the only correct behaviour. `parse`
 * rejects an item whose `parentId` names no existing item, so leaving children
 * behind would write a file that the next load refuses outright. Reparenting
 * them to the root instead would silently promote work the user meant to be
 * subordinate, which is a quieter but worse surprise.
 *
 * One pass suffices because nesting is one level deep by construction (see
 * `Item.parentId` — "One level of nesting only"). If that ever changes this
 * needs to become a fixpoint walk, and a stale single pass would orphan
 * grandchildren rather than fail loudly, so the assumption is called out here.
 *
 * Returns `null` when the id is not present, matching the no-op contract used
 * across the codebase — a delete of something already gone writes nothing.
 */
export function removeItem(weekspan: Weekspan, id: string): Weekspan | null {
  if (!weekspan.items.some((i) => i.id === id)) return null

  const doomed = new Set<string>([id])
  for (const item of weekspan.items) {
    if (item.parentId != null && doomed.has(item.parentId)) doomed.add(item.id)
  }

  return { ...weekspan, items: weekspan.items.filter((i) => !doomed.has(i.id)) }
}

/** The items `removeItem` would delete, for a caller that wants to say so first. */
export function itemsRemovedBy(weekspan: Weekspan, id: string): Item[] {
  const target = weekspan.items.find((i) => i.id === id)
  if (!target) return []
  const children = weekspan.items.filter((i) => i.parentId === id)
  return [target, ...children]
}

/**
 * Where a newly-captured item should land: immediately above the first ROOT
 * item that has nothing in it this week.
 *
 * Returns the id to insert BEFORE, or `null` for "append at the end" (which
 * happens when every root already carries a marker this week).
 *
 * The brief described this two ways — "immediately below the last item with a
 * marker this week" and "the first non-marked item" — and those only agree when
 * the marked items form an unbroken block at the top. On an interleaved list
 * they disagree, and this takes the second reading: a new item lands at the TOP
 * of the unscheduled block, as high as it can go without jumping above work you
 * have already scheduled. The first reading would drop it below unscheduled
 * items that happen to sit above a late marked one, which is both harder to
 * predict and less useful.
 *
 * "A marker" is any effective mark — due, done or skip, generated or explicit.
 * The question being answered is "does this row show anything this week", and a
 * skip is as much an answer as a completion.
 *
 * Roots only. Ranks are sibling-scoped and a capture creates a top-level item,
 * so a child's marks say nothing about where that item belongs.
 */
export function defaultInsertBeforeId(
  weekspan: Weekspan,
  today: IsoDate,
  vacationDays: VacationDays = weekspan.vacationDays,
): string | null {
  const week = allWeekDates(weekOf(today))
  const roots = orderItems(weekspan.items).filter((i) => i.parentId == null)

  for (const item of roots) {
    const marked = week.some((date) => effectiveMark(item, date, vacationDays) !== undefined)
    if (!marked) return item.id
  }
  return null
}

/**
 * The full anchor pair for a default insert — both neighbours, not just one.
 *
 * Naming both neighbours pins the new item into the one-slot gap. It used to be
 * the ONLY thing that did: `rankForInsert(null, anchor)` read a missing lower
 * bound as "below everything" and dropped the item at the top of the list.
 * `rankForInsert` now resolves an unnamed bound from the rank scope, so a bare
 * `beforeId` does mean "immediately before that item" — but naming the pair is
 * still cheaper (no lookup) and says plainly which gap was meant.
 *
 * Returns a spreadable fragment with keys ABSENT rather than undefined, because
 * `insertItem` is compiled under `exactOptionalPropertyTypes`.
 */
export function defaultInsertAnchor(
  weekspan: Weekspan,
  today: IsoDate,
  vacationDays: VacationDays = weekspan.vacationDays,
): { afterId?: string; beforeId?: string } {
  const roots = orderItems(weekspan.items).filter((i) => i.parentId == null)
  if (roots.length === 0) return {}

  const beforeId = defaultInsertBeforeId(weekspan, today, vacationDays)
  if (beforeId === null) {
    // Everything is marked this week: append after the last root.
    return { afterId: roots[roots.length - 1]!.id }
  }

  const index = roots.findIndex((i) => i.id === beforeId)
  const previous = index > 0 ? roots[index - 1] : undefined
  return { beforeId, ...(previous ? { afterId: previous.id } : {}) }
}
