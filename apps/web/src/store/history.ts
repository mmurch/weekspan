/**
 * Undo history — pure, no React, no store.
 *
 * Kept out of `useWeekspan` for the same reason `keymap.ts` and `selection.ts`
 * are kept out of the components that use them: the interesting behaviour is a
 * state machine, and a state machine is far easier to pin down with a table of
 * cases than through a renderer. There is no jsdom in this workspace, so a hook
 * test would need a new dependency to say much less.
 *
 * The model is a pair of stacks holding whole past VALUES, which is only viable
 * because `mutate`'s `apply` already returns a complete immutable `Weekspan`.
 * No command objects, no inverse operations.
 *
 * Restoring a value is last-writer-wins across the whole file, whereas every
 * other write path merges at item and cell granularity — so the caller is
 * expected to `forget()` the moment anything else touches the file. That
 * asymmetry is why this module is deliberately dumb: it has no idea what a
 * weekspan is and makes no attempt to be clever about reconciling one.
 */

export interface History<T> {
  /** States we can go back to, oldest first. `past.at(-1)` is one step back. */
  past: readonly T[]
  /** States undone, for redo. `future.at(-1)` is one step forward. */
  future: readonly T[]
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/**
 * Record a change: `previous` becomes undoable, and redo is dropped.
 *
 * Redo is dropped because a new change BRANCHES off whatever was undone —
 * keeping the old forward states would let a redo jump to a future that no
 * longer follows from the present.
 *
 * `max` bounds the stack from the OLD end, so the most recent steps always
 * survive. Callers only reach here when something actually changed (`mutate`
 * returns early on a null apply), so a no-op interaction never consumes a slot.
 */
export function record<T>(history: History<T>, previous: T, max: number): History<T> {
  if (max <= 0) return emptyHistory()
  return { past: [...history.past, previous].slice(-max), future: [] }
}

/**
 * Step back. Returns the state to restore and the history that results, or
 * `null` when there is nothing to undo — the caller writes nothing in that case.
 */
export function undo<T>(history: History<T>, current: T, max: number): { history: History<T>; target: T } | null {
  const target = history.past.at(-1)
  if (target === undefined) return null
  return {
    target,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current].slice(-max),
    },
  }
}

/** Step forward again. `null` when nothing was undone, or a new change branched. */
export function redo<T>(history: History<T>, current: T, max: number): { history: History<T>; target: T } | null {
  const target = history.future.at(-1)
  if (target === undefined) return null
  return {
    target,
    history: {
      past: [...history.past, current].slice(-max),
      future: history.future.slice(0, -1),
    },
  }
}
