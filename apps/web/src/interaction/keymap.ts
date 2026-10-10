/**
 * Keyboard interaction — a data-driven shortcut table plus a pure reducer.
 *
 * `resolveKey` turns a raw `KeyboardEvent` into an `Action`; `applyAction` turns
 * an `Action` plus current state into the next state. Splitting them is what
 * makes the reducer testable without a DOM: `applyAction` never touches
 * `window`, the store, or a clock — `today` is passed in, same as the rest of
 * this codebase.
 *
 * Bindings are from design_handoff_todo_ledger/README.md ("4. Cell menu &
 * vacation" and the footer shortcut legend in "1. Priority view"), and are
 * EXPLICITLY called out there as provisional. Keep `KEYMAP` the single source
 * of truth so re-mapping later is a data edit, not a rewrite of `resolveKey`.
 */

import type { IsoDate, Item, Weekspan } from '@weekspan/weekspan-core'
import {
  addDays,
  clearMark,
  minimalMoveRank,
  setDone,
  setDue,
  setSkip,
  siblingsOf,
} from '@weekspan/weekspan-core'
import { buildGrid } from '../grid/viewModel.js'
import { nextMarkState } from './cycle.js'
import { isTypingTarget } from './isTypingTarget.js'
import { indentItem, outdentItem } from './nesting.js'
import { moveSelection, type Selection } from './selection.js'

export type Action =
  | { kind: 'setDue' }
  | { kind: 'setDone' }
  | { kind: 'clear' }
  | { kind: 'setSkip' }
  | { kind: 'cycle' }
  | { kind: 'move'; dir: 'up' | 'down' | 'left' | 'right' }
  | { kind: 'reorder'; dir: 'up' | 'down' }
  | { kind: 'nudgeDue'; dir: 'left' | 'right' }
  | { kind: 'newItem' }
  | { kind: 'sort' }
  | { kind: 'escape' }
  | { kind: 'indent' }
  | { kind: 'outdent' }

interface KeyBinding {
  /** `KeyboardEvent.key`, lower-cased. */
  key: string
  /** Whether Option/Alt must be held. Absent (falsy) means "must NOT be held". */
  alt?: boolean
  /** Whether Shift must be held. Absent (falsy) means "must NOT be held". */
  shift?: boolean
  action: Action
}

/**
 * The shortcut table. `V` (done) and `D` (due) are mnemonic — V for the
 * checkmark it produces, D for "due" — and must not be reassigned even though
 * the rest of the set is provisional.
 *
 * `setSkip` has no binding here: neither the footer legend nor the cell menu
 * (3d) exposes one today. `applyAction` still supports it — vacation-day
 * auto-rescheduling and any future binding both need it — but nothing in this
 * table dispatches it yet.
 *
 * `Enter` drives the same mark-state LOOP a click on the cell does (see
 * `cycle.ts`): blank -> due -> done -> blank, or with skip inserted before
 * the wrap for a recurring item. It shares `applyAction`'s single code path
 * with the click handler on purpose, so keyboard and mouse can never
 * disagree about what "the next state" is.
 */
export const KEYMAP: readonly KeyBinding[] = [
  { key: 'd', action: { kind: 'setDue' } },
  { key: 'v', action: { kind: 'setDone' } },
  { key: 'x', action: { kind: 'clear' } },
  { key: 'n', action: { kind: 'newItem' } },
  { key: 's', action: { kind: 'sort' } },
  { key: 'enter', action: { kind: 'cycle' } },
  { key: 'escape', action: { kind: 'escape' } },
  { key: 'arrowup', action: { kind: 'move', dir: 'up' } },
  { key: 'arrowdown', action: { kind: 'move', dir: 'down' } },
  { key: 'arrowleft', action: { kind: 'move', dir: 'left' } },
  { key: 'arrowright', action: { kind: 'move', dir: 'right' } },
  { key: 'arrowup', alt: true, action: { kind: 'reorder', dir: 'up' } },
  { key: 'arrowdown', alt: true, action: { kind: 'reorder', dir: 'down' } },
  { key: 'arrowleft', alt: true, action: { kind: 'nudgeDue', dir: 'left' } },
  { key: 'arrowright', alt: true, action: { kind: 'nudgeDue', dir: 'right' } },
  // Tab / Shift+Tab indent and outdent the selected item — the design handoff's
  // "⇥⇥ indents a draft as a sub-item", extended to an existing selected row.
  { key: 'tab', action: { kind: 'indent' } },
  { key: 'tab', shift: true, action: { kind: 'outdent' } },
]


/**
 * Maps a raw keyboard event to an `Action`, or `null` if it isn't bound.
 *
 * Refuses while focus is in an input/textarea/contenteditable (typing "d" in
 * a title must not set a due date) and while Cmd/Ctrl is held (those are
 * browser/app shortcuts, not ours).
 */
export function resolveKey(e: KeyboardEvent): Action | null {
  if (e.metaKey || e.ctrlKey) return null
  if (isTypingTarget(e.target)) return null

  const key = e.key.toLowerCase()
  const alt = e.altKey
  const shift = e.shiftKey
  const binding = KEYMAP.find(
    (b) => b.key === key && Boolean(b.alt) === alt && Boolean(b.shift) === shift,
  )
  return binding ? binding.action : null
}

export interface ActionResult {
  /** The next weekspan, or null meaning "nothing to write" — same contract as `mutate`. */
  weekspan: Weekspan | null
  selection: Selection | null
}

/**
 * Pure reducer: `(action, current state) -> next state`. No store access, no
 * side effects — callers thread `weekspan: null` results straight into
 * `WeekspanStore.mutate`, where null already means "no write".
 */
export function applyAction(
  action: Action,
  sel: Selection | null,
  weekspan: Weekspan,
  today: IsoDate,
): ActionResult {
  switch (action.kind) {
    case 'escape':
      return { weekspan: null, selection: null }

    case 'move': {
      if (sel === null) return { weekspan: null, selection: null }
      const vm = buildGrid(weekspan, today)
      return { weekspan: null, selection: moveSelection(sel, vm, action.dir) }
    }

    case 'setDue':
    case 'setDone':
    case 'clear':
    case 'setSkip':
      return applyMark(action.kind, sel, weekspan)

    case 'cycle':
      return applyCycle(sel, weekspan, today)

    case 'reorder':
      return applyReorder(action.dir, sel, weekspan)

    case 'nudgeDue':
      return applyNudgeDue(action.dir, sel, weekspan)

    case 'indent':
    case 'outdent':
      return applyNesting(action.kind, sel, weekspan)

    case 'newItem':
      // Item creation belongs to the hover-seam / Enter-split / quick-capture
      // interactions (handoff section 3), not the keymap — out of scope here.
      // Resolved so the binding exists and is testable, but it never writes.
      return { weekspan: null, selection: sel }

    case 'sort':
      // Sort-by-date is a whole-list action the caller owns (it needs the
      // notice for "already sorted"), so the reducer stays out of it — same
      // shape as `newItem`. The binding exists and is testable; it never writes.
      return { weekspan: null, selection: sel }
  }
}

function findItem(weekspan: Weekspan, itemId: string): Item | undefined {
  return weekspan.items.find((i) => i.id === itemId)
}

function withItem(weekspan: Weekspan, next: Item): Weekspan {
  return { ...weekspan, items: weekspan.items.map((i) => (i.id === next.id ? next : i)) }
}

/**
 * due / done / clear / skip on the selected cell.
 *
 * Vacation days refuse due and done (the design: vacation cells "refuse due
 * dates and completions") but allow skip and clear — clearing a mark or
 * marking a vacation day deliberately skipped are both fine on a day nothing
 * is meant to happen.
 */
function applyMark(
  kind: 'setDue' | 'setDone' | 'clear' | 'setSkip',
  sel: Selection | null,
  weekspan: Weekspan,
): ActionResult {
  if (sel === null) return { weekspan: null, selection: null }
  // The ITEM column carries no date, so there is no cell to mark. Keep the
  // selection and write nothing rather than guessing a day.
  if (sel.date === null) return { weekspan: null, selection: sel }

  const isVacation = weekspan.vacationDays.includes(sel.date)
  if (isVacation && (kind === 'setDue' || kind === 'setDone')) {
    return { weekspan: null, selection: sel }
  }

  const item = findItem(weekspan, sel.itemId)
  if (!item) return { weekspan: null, selection: null }

  const next =
    kind === 'setDue'
      ? setDue(item, sel.date)
      : kind === 'setDone'
        ? setDone(item, sel.date)
        : kind === 'setSkip'
          ? setSkip(item, sel.date, 'deliberate')
          : clearMark(item, sel.date)

  // setMark/clearMark return the SAME reference on a no-op — that is exactly
  // the signal to write nothing.
  if (next === item) return { weekspan: null, selection: sel }

  return { weekspan: withItem(weekspan, next), selection: sel }
}

/**
 * Enter (or a cell click) on the selected cell: advance its mark one step
 * through the loop `cycle.ts` defines. Selection semantics mirror
 * `applyMark` exactly — a missing item drops the selection, everything else
 * (including a refused or no-op cycle) keeps it — so `cycle` slots into the
 * reducer the same way every other mark action does; only the mark math
 * itself lives elsewhere, in the one module click and keyboard both share.
 */
function applyCycle(sel: Selection | null, weekspan: Weekspan, today: IsoDate): ActionResult {
  if (sel === null) return { weekspan: null, selection: null }
  if (!findItem(weekspan, sel.itemId)) return { weekspan: null, selection: null }
  // On the item column Enter means "edit this title", which is a UI concern the
  // caller owns (see App's keydown handler). The reducer stays out of it and
  // writes nothing, so this cannot silently mark a cell instead.
  if (sel.date === null) return { weekspan: null, selection: sel }

  return { weekspan: nextMarkState(weekspan, sel.itemId, sel.date, today), selection: sel }
}

/**
 * Move the selected row one slot up/down among its siblings (same parent),
 * using `minimalMoveRank` so a reorder that is already satisfied writes
 * nothing at all.
 */
function applyReorder(dir: 'up' | 'down', sel: Selection | null, weekspan: Weekspan): ActionResult {
  if (sel === null) return { weekspan: null, selection: null }
  const item = findItem(weekspan, sel.itemId)
  if (!item) return { weekspan: null, selection: null }

  const siblings = siblingsOf(weekspan.items, item.parentId ?? null)
  const idx = siblings.findIndex((i) => i.id === item.id)
  if (idx === -1) return { weekspan: null, selection: sel }

  let before: Item | null
  let after: Item | null
  if (dir === 'up') {
    if (idx === 0) return { weekspan: null, selection: sel } // already first
    after = siblings[idx - 1]!
    before = idx - 2 >= 0 ? siblings[idx - 2]! : null
  } else {
    if (idx === siblings.length - 1) return { weekspan: null, selection: sel } // already last
    before = siblings[idx + 1]!
    after = idx + 2 < siblings.length ? siblings[idx + 2]! : null
  }

  const rank = minimalMoveRank(item, before, after, weekspan.items)
  if (rank === null) return { weekspan: null, selection: sel } // already in position

  return { weekspan: withItem(weekspan, { ...item, rank }), selection: sel }
}

/**
 * Nudge the due mark AT THE SELECTED CELL by one day. A no-op (not an error)
 * when the selected cell has no due mark to nudge, or when the destination
 * day is vacation — same refusal as `setDue`.
 */
function applyNudgeDue(dir: 'left' | 'right', sel: Selection | null, weekspan: Weekspan): ActionResult {
  if (sel === null) return { weekspan: null, selection: null }
  // Nothing to nudge from the item column — there is no due date there.
  if (sel.date === null) return { weekspan: null, selection: sel }
  const item = findItem(weekspan, sel.itemId)
  if (!item) return { weekspan: null, selection: null }

  const mark = item.marks[sel.date]
  if (!mark || mark.kind !== 'due') return { weekspan: null, selection: sel }

  const nextDate = addDays(sel.date, dir === 'left' ? -1 : 1)
  if (weekspan.vacationDays.includes(nextDate)) return { weekspan: null, selection: sel }

  const moved = setDue(clearMark(item, sel.date), nextDate)
  return { weekspan: withItem(weekspan, moved), selection: { itemId: item.id, date: nextDate } }
}

/**
 * Tab / Shift+Tab on the selected row: nest it under the preceding root, or
 * promote it back to a root. All the "may this happen" logic (one level of
 * nesting, no preceding root, would-orphan-grandchildren) lives in
 * `nesting.ts`; this just wires its null-means-refused contract into the
 * reducer the same way every other action here does.
 */
function applyNesting(kind: 'indent' | 'outdent', sel: Selection | null, weekspan: Weekspan): ActionResult {
  if (sel === null) return { weekspan: null, selection: null }
  const next = kind === 'indent' ? indentItem(weekspan, sel.itemId) : outdentItem(weekspan, sel.itemId)
  return { weekspan: next, selection: sel }
}
