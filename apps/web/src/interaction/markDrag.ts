/**
 * Dragging a MARK — the DUE / ✓ / SKIP chip sitting in a cell.
 *
 * Grabbing a chip drags on both axes at once, and each axis means what that
 * axis already means everywhere else in the grid:
 *
 *   - horizontally, the columns ARE the days, so moving a chip left or right
 *     moves the mark to the day under the pointer;
 *   - vertically, the rows ARE the priority order, so the row reorders exactly
 *     as it does from the grip in the item column.
 *
 * Diagonal is not a third gesture with rules of its own — it is just both
 * happening, which is why they are resolved independently and committed
 * together. `useDragPreview` owns the pointer lifecycle for both (one
 * threshold, one Escape, one release), so a chip drag cannot end up with a
 * different feel from a grip drag.
 *
 * This module is the horizontal half plus the write. Everything here is pure
 * except `measureColumns`, which is the one DOM read; the geometry decision
 * (`dateForX`) is deliberately split out from it so the column-picking rule is
 * testable without a browser, matching how `dragPreview.ts` splits
 * `measureRows` from `previewIndexFor`.
 */

import type { IsoDate, Weekspan } from '@weekspan/weekspan-core'
import { clearMark, setMark } from '@weekspan/weekspan-core'

export interface ColumnBox {
  date: IsoDate
  left: number
  width: number
}

/**
 * The day columns, in date order, as viewport rects.
 *
 * Every cell carries `data-cell-date`, and every cell sharing a date shares an
 * x-position (that is what the screenshot harness asserts), so one row's worth
 * of cells describes the whole grid — the first element seen per date wins and
 * the rest are skipped. Measured once, at pointerdown, the same way rows are.
 */
export function measureColumns(scope: ParentNode = document): ColumnBox[] {
  const seen = new Set<string>()
  const out: ColumnBox[] = []
  for (const el of scope.querySelectorAll<HTMLElement>('[data-cell-date]')) {
    const date = el.dataset['cellDate']
    if (date === undefined || seen.has(date)) continue
    seen.add(date)
    const r = el.getBoundingClientRect()
    // A zero-width box is a column that is not laid out (a collapsed group, a
    // display:none ancestor). Including it would create a target the pointer
    // can never be over but that `dateForX` could still snap to.
    if (r.width === 0) continue
    out.push({ date, left: r.left, width: r.width })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * The day under `x`, or `null` when there are no columns to choose from.
 *
 * Inside a column, that column wins. Outside every column — past either end of
 * the window, which is easy to reach since the grid scrolls horizontally and
 * the pointer can leave it entirely — the NEAREST column wins rather than the
 * drag going dead. Nearest is measured to the column's own edge, so the answer
 * at the extremes is simply the first or last day.
 *
 * Weekend and vacation columns are offered like any other. Whether a mark may
 * actually land there is `moveMark`'s call, not geometry's: the preview shows
 * the day the pointer is on, and a refused drop writes nothing.
 */
export function dateForX(columns: readonly ColumnBox[], x: number): IsoDate | null {
  if (columns.length === 0) return null

  let best: ColumnBox | undefined
  let bestDistance = Infinity
  for (const c of columns) {
    const right = c.left + c.width
    if (x >= c.left && x < right) return c.date
    const distance = x < c.left ? c.left - x : x - right
    if (distance < bestDistance) {
      bestDistance = distance
      best = c
    }
  }
  return best ? best.date : null
}

/**
 * Move the explicit mark at `from` to `to`, preserving its kind (and, for a
 * skip, its provenance — a deliberate skip that got dragged is still
 * deliberate).
 *
 * Returns `null` — the `mutate` no-op contract — for every case where there is
 * nothing legitimate to write:
 *
 *   - the chip did not change day;
 *   - the item is gone (a competing writer merged it away mid-drag);
 *   - there is no EXPLICIT mark at `from`. A chip drawn from a recurrence rule
 *     has no stored mark to move, and inventing one at the destination would
 *     silently convert a rule into a hand-placed date;
 *   - the destination is a vacation day and the mark is a due or a done. This
 *     is the same refusal `applyMark` in `keymap.ts` makes, for the same
 *     reason — vacation cells "refuse due dates and completions" — and a skip
 *     is allowed through there and here alike.
 *
 * Any mark already sitting on the destination is REPLACED, which is forced:
 * at most one mark lives at a given (item, date), so a move is a clear-then-set
 * on one item's own map — exactly what `vacation.ts` does when it reschedules.
 */
export function moveMark(
  weekspan: Weekspan,
  itemId: string,
  from: IsoDate,
  to: IsoDate,
): Weekspan | null {
  if (from === to) return null

  const item = weekspan.items.find((i) => i.id === itemId)
  if (!item) return null

  const mark = item.marks[from]
  if (!mark) return null

  if (mark.kind !== 'skip' && weekspan.vacationDays.includes(to)) return null

  const next = setMark(clearMark(item, from), to, mark)
  if (next === item) return null

  return { ...weekspan, items: weekspan.items.map((i) => (i.id === next.id ? next : i)) }
}
