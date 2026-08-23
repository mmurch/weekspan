import type { IsoDate, Item, Mark } from './types.js'
import { getMark, latestMarkDate } from './marks.js'
import { currentPeriod, occursOn } from './recurrence.js'

/**
 * Derived state: finished-ness, display state, and cell-level rendering
 * facts, all computed from an item's marks and recurrence rule — never
 * stored. See ARCHITECTURE.md "Finished state — derived, never stored" and
 * "Recurring items". There is deliberately no `status` field on `Item`: the
 * user was explicit that they never want two places to mark something done.
 *
 * Every function here is pure and re-derives its answer from `item` (and,
 * where relevant, `today` / `closingWeekEnd`) on every call.
 */

/**
 * A non-recurring item is finished when its latest NON-SKIP mark is `done`.
 * Skips are transparent: skipping one chunk of an otherwise-complete item
 * must not drag it back to unfinished, so trailing skip marks are ignored
 * when finding "the latest mark that counts."
 *
 * A recurring item is never finished — a standing commitment isn't something
 * you complete, so it's never archived either.
 *
 * An item with no marks at all (or only skip marks) is not finished.
 */
export function isFinished(item: Item): boolean {
  if (item.recurrence) return false

  const dates = Object.keys(item.marks).sort()
  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i]
    if (date === undefined) continue
    const mark = getMark(item, date)
    if (mark === undefined || mark.kind === 'skip') continue
    return mark.kind === 'done'
  }
  return false
}

/**
 * The mark that should render in this item's cell at `date`.
 *
 * An explicit mark always wins — that's how a completion or skip records an
 * exception to the rule. Absent an explicit mark, a recurring item whose
 * rule generates an occurrence on `date` renders a synthesized `{ kind:
 * 'due' }`. Otherwise there's nothing to show.
 */
export function effectiveMark(item: Item, date: IsoDate): Mark | undefined {
  const explicit = getMark(item, date)
  if (explicit) return explicit

  if (item.recurrence && occursOn(item.recurrence, date)) {
    return { kind: 'due' }
  }

  return undefined
}

/**
 * True only when the due-ness at `date` comes from the recurrence rule
 * rather than an explicit mark — i.e. `effectiveMark` returned a synthesized
 * occurrence rather than something stored on the item. Close-out needs to
 * tell these apart: a generated occurrence auto-resolves during catch-up,
 * an explicit due does not.
 */
export function isGeneratedOccurrence(item: Item, date: IsoDate): boolean {
  if (getMark(item, date)) return false
  return item.recurrence !== undefined && item.recurrence !== null && occursOn(item.recurrence, date)
}

export type DisplayState = 'open' | 'finished' | 'skipped'

/**
 * The state a row (or a recurring item's current-period cell) should render
 * as, as of `today`.
 *
 * Non-recurring items look at the whole item via `isFinished` / the latest
 * mark. Recurring items look ONLY at the rule's own current period
 * (`currentPeriod`, not the calendar week) — a monthly item completed on
 * the 3rd reads as done for the rest of that month rather than flipping
 * back to pending at the next weekly boundary.
 */
export function displayState(item: Item, today: IsoDate): DisplayState {
  if (!item.recurrence) {
    if (isFinished(item)) return 'finished'
    const latest = latestMarkDate(item)
    const latestMark = latest !== undefined ? getMark(item, latest) : undefined
    if (latestMark?.kind === 'skip') return 'skipped'
    return 'open'
  }

  const { from, to } = currentPeriod(item.recurrence, today)
  let sawSkip = false
  for (const [date, mark] of Object.entries(item.marks)) {
    if (date < from || date > to) continue
    if (mark.kind === 'done') return 'finished'
    if (mark.kind === 'skip') sawSkip = true
  }
  return sawSkip ? 'skipped' : 'open'
}

/**
 * An item is archivable at close-out only if it's finished AND its latest
 * mark falls on or before the closing week's end. Without the second
 * clause, closing W35 could rip out an item that still has live cells in
 * W36 (e.g. a done mark on Tue plus a due mark next week from some earlier
 * chunking).
 */
export function isArchivable(item: Item, closingWeekEnd: IsoDate): boolean {
  if (!isFinished(item)) return false
  const latest = latestMarkDate(item)
  if (latest === undefined) return false
  return latest <= closingWeekEnd
}

export interface RowStyle {
  strikethrough: boolean
  italic: boolean
  deemphasized: boolean
}

/**
 * Render hint for a row's `DisplayState`. Skipped rows render the way the
 * web renders disabled — italicized and de-emphasized, NEVER struck
 * through. Strikethrough is reserved for completion; conflating "I didn't
 * do this" with "I finished this" is exactly the wrong signal on a habit
 * the user is trying to break.
 */
export function rowStyle(state: DisplayState): RowStyle {
  switch (state) {
    case 'finished':
      return { strikethrough: true, italic: false, deemphasized: false }
    case 'skipped':
      return { strikethrough: false, italic: true, deemphasized: true }
    case 'open':
      return { strikethrough: false, italic: false, deemphasized: false }
  }
}
