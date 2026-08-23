import type { IsoDate, Item, Mark, MarkKind, SkipProvenance } from './types.js'
import { isValidIsoDate } from './dates.js'

/**
 * Marks: the sparse per-(item, date) cell map that replaces the handoff's
 * single `due` / `done_on` scalars (see ARCHITECTURE.md "Marks"). At most one
 * mark lives at a given (item, date) pair, matching the cell menu's
 * mutually-exclusive Mark done / Set due / Clear.
 *
 * Every function here is pure: the input `Item` (and its `marks` map) is
 * never mutated, and a new `Item` is only returned when something actually
 * changed. Callers rely on that structural sharing to skip writes and
 * re-renders — see `clearMark`'s no-op case and the equal-mark short-circuit
 * in `setMark`.
 *
 * No recurrence logic lives here. A recurring item's rule can imply a due
 * occurrence with no explicit mark at all; resolving "is this date due" is a
 * separate module's job. This module only ever sees explicit marks.
 */

function requireValidDate(date: IsoDate): void {
  if (!isValidIsoDate(date)) {
    throw new Error(`Invalid IsoDate: ${JSON.stringify(date)} (expected YYYY-MM-DD)`)
  }
}

/** The explicit mark at `date`, if any. */
export function getMark(item: Item, date: IsoDate): Mark | undefined {
  requireValidDate(date)
  return item.marks[date]
}

/** Structural equality for two marks, including skip provenance. */
function sameMark(a: Mark, b: Mark): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'skip' && b.kind === 'skip') return a.provenance === b.provenance
  return true
}

/**
 * General form: set (or replace) the mark at `date`.
 *
 * `Mark` is a discriminated union, so a non-skip mark carrying `provenance` is
 * now a compile error rather than the runtime throw this used to need. What
 * remains is normalization: the stored value is rebuilt from its own fields
 * rather than holding the caller's object reference, so the marks map always
 * serializes identically no matter how the caller constructed the value.
 */
export function setMark(item: Item, date: IsoDate, mark: Mark): Item {
  requireValidDate(date)

  const normalized: Mark =
    mark.kind === 'skip' ? { kind: 'skip', provenance: mark.provenance } : { kind: mark.kind }

  const existing = item.marks[date]
  if (existing && sameMark(existing, normalized)) {
    return item
  }

  return {
    ...item,
    marks: { ...item.marks, [date]: normalized },
  }
}

/** Mark `date` due. Replaces whatever mark (if any) was there. */
export function setDue(item: Item, date: IsoDate): Item {
  return setMark(item, date, { kind: 'due' })
}

/** Mark `date` done. Replaces whatever mark (if any) was there. */
export function setDone(item: Item, date: IsoDate): Item {
  return setMark(item, date, { kind: 'done' })
}

/**
 * Mark `date` skipped. `provenance` is required — there is no default —
 * because a defaulted value would silently corrupt the deliberate-vs-auto
 * split that skip-streak surfacing depends on (see ARCHITECTURE.md
 * "Auto-close" and `SkipProvenance`).
 */
export function setSkip(item: Item, date: IsoDate, provenance: SkipProvenance): Item {
  return setMark(item, date, { kind: 'skip', provenance })
}

/**
 * Remove the mark at `date`, if one exists. A no-op on an unmarked date
 * returns the SAME `Item` reference (not an equal copy) so callers can skip
 * a write when nothing changed.
 */
export function clearMark(item: Item, date: IsoDate): Item {
  requireValidDate(date)
  if (!(date in item.marks)) return item

  const marks = { ...item.marks }
  delete marks[date]
  return { ...item, marks }
}

/** All dates with an explicit mark, sorted ascending. */
export function markDates(item: Item): IsoDate[] {
  // IsoDate is zero-padded YYYY-MM-DD, so lexicographic sort is chronological.
  return Object.keys(item.marks).sort()
}

/** The latest explicit mark date, or `undefined` if the item has no marks. */
export function latestMarkDate(item: Item): IsoDate | undefined {
  const dates = markDates(item)
  return dates[dates.length - 1]
}

/** Explicit marks with `from <= date <= to`, sorted ascending. Both ends inclusive. */
export function marksInRange(
  item: Item,
  from: IsoDate,
  to: IsoDate,
): Array<{ date: IsoDate; mark: Mark }> {
  requireValidDate(from)
  requireValidDate(to)
  return Object.entries(item.marks)
    .filter(([date]) => date >= from && date <= to)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, mark]) => ({ date, mark }))
}

/** Whether the item has any explicit mark of the given kind, anywhere. */
export function hasMarkOfKind(item: Item, kind: MarkKind): boolean {
  return Object.values(item.marks).some((mark) => mark.kind === kind)
}
