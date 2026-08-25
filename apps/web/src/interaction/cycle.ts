/**
 * Mark-state cycling for the Weekspan grid.
 *
 * Clicking a cell that takes marks (or pressing Enter while one is selected —
 * see `keymap.ts`'s `{ kind: 'cycle' }` action) advances it one step through a
 * fixed loop:
 *
 *   non-recurring: blank -> due -> done -> blank
 *   recurring:     blank -> due -> done -> skip -> blank
 *
 * "Recurring" is a property of the ITEM (`item.recurrence != null`), never of
 * the cell — every cell of a recurring item, generated or not, gets the
 * four-state loop, including dates the rule doesn't generate an occurrence on.
 *
 * This module is the ONE place that decides what "next" means; `keymap.ts`
 * routes both click and Enter through it so the two input paths can never
 * drift apart.
 */

import type { IsoDate, Item, MarkKind, Weekspan } from '@weekspan/weekspan-core'
import { clearMark, effectiveMark, setDone, setDue, setSkip } from '@weekspan/weekspan-core'

/**
 * Cycle order for each item kind, `null` standing in for "blank" (no
 * explicit mark). Index arithmetic below relies on `null` always being the
 * first entry: stepping off the end of the array wraps back to blank.
 */
const NON_RECURRING_CYCLE: ReadonlyArray<MarkKind | null> = [null, 'due', 'done']
const RECURRING_CYCLE: ReadonlyArray<MarkKind | null> = [null, 'due', 'done', 'skip']

/**
 * Pure step function: given an item and a date, what should the mark kind
 * become next, where `null` means "blank" (no explicit mark)?
 *
 * Reads the CURRENT state via `effectiveMark` rather than `getMark`, so a
 * generated due — a recurring item's rule implying `due` with no explicit
 * mark at all — counts as `'due'` for cycling purposes exactly like an
 * explicit due would. (Writing that next step is `nextMarkState`'s job, and
 * it always writes an EXPLICIT mark; see that function's doc for why.)
 *
 * A mark kind that doesn't belong to the item's cycle (e.g. a stray `skip`
 * somehow left on a non-recurring item, which the loop itself never
 * produces but which other code paths such as the unbound `setSkip` action
 * could) is treated as sitting "before" the loop and steps to blank, so the
 * next press resumes the normal sequence instead of getting stuck.
 *
 * `vacationDays` reaches `effectiveMark`, so a recurring item reads as blank
 * on a vacation day rather than as a generated due. Cycling there still
 * lands nowhere — `nextMarkState`'s vacation guard refuses the `due` step
 * that blank advances to — but the read side now agrees with what the grid
 * paints instead of stepping from a due the user cannot see.
 */
export function cycleFor(
  item: Item,
  date: IsoDate,
  vacationDays: readonly IsoDate[],
): MarkKind | null {
  const cycle = item.recurrence != null ? RECURRING_CYCLE : NON_RECURRING_CYCLE
  const current = effectiveMark(item, date, vacationDays)?.kind ?? null
  const idx = cycle.indexOf(current)
  const nextIdx = idx === -1 ? 0 : (idx + 1) % cycle.length
  return cycle[nextIdx]!
}

/**
 * Advance the mark at `(itemId, date)` one step through its cycle and return
 * the next `Weekspan`, or `null` if there is nothing to write — the same
 * "null means no write" contract `WeekspanStore.mutate` and `applyAction`
 * already use everywhere else, so callers (click handler, `keymap.ts`) can
 * treat this identically to `setDue`/`setDone`/etc.
 *
 * Two write-side rules apply on top of the pure `cycleFor` step:
 *
 * - Vacation days refuse `due` and `done`, same as everywhere else in this
 *   codebase (design: vacation cells "refuse due dates and completions").
 *   Skip and clear remain allowed, since both are fine on a day nothing is
 *   meant to happen. This can only make cycling a no-op on a vacation day,
 *   never change WHERE it lands — see `applyMark` in `keymap.ts` for the
 *   identical rule stated the other way around.
 *
 * - Every write is EXPLICIT, even on a generated occurrence. Cycling from a
 *   generated due to done writes an explicit `done` mark, not a synthesized
 *   one — that explicit mark is the whole point of an exception. Cycling a
 *   generated occurrence all the way to "blank" therefore means CLEARING
 *   that explicit mark, not writing an absence: once cleared, the rule's
 *   generated due reappears on the very next read via `effectiveMark`. That
 *   is correct and expected, not a bug — a generated occurrence with no
 *   exception recorded against it IS due, by definition of the rule that
 *   generates it. It can look like the clear "didn't take" if you forget
 *   that generated cells have no true empty state to land on.
 *
 * `today` is accepted for the same reason every date-dependent function in
 * `@weekspan/weekspan-core` takes it explicitly, even though today's cycle
 * rule happens not to branch on it: a future rule that DOES depend on the
 * clock (e.g. refusing to cycle a date far in the future) can add that
 * check here without changing any call site in `keymap.ts` or the grid's
 * click handler.
 */
export function nextMarkState(
  weekspan: Weekspan,
  itemId: string,
  date: IsoDate,
  today: IsoDate,
): Weekspan | null {
  void today // reserved — see doc comment above

  const item = weekspan.items.find((i) => i.id === itemId)
  if (!item) return null

  const next = cycleFor(item, date, weekspan.vacationDays)

  const isVacation = weekspan.vacationDays.includes(date)
  if (isVacation && (next === 'due' || next === 'done')) return null

  const updated =
    next === null
      ? clearMark(item, date)
      : next === 'due'
        ? setDue(item, date)
        : next === 'done'
          ? setDone(item, date)
          : setSkip(item, date, 'deliberate')

  // setMark/clearMark return the SAME reference on a no-op — that is exactly
  // the signal to write nothing (mirrors `applyMark` in keymap.ts).
  if (updated === item) return null

  return { ...weekspan, items: weekspan.items.map((i) => (i.id === item.id ? updated : i)) }
}
