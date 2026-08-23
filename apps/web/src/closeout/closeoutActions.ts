import type { ArchiveFile, CloseBlocker, IsoDate, IsoWeek, Item, Weekspan } from '@weekspan/weekspan-core'
import { autoClose, closeWeek, oldestUnclosedWeek, unresolvedInWeek, weekOf, weeksBetween } from '@weekspan/weekspan-core'

/**
 * Pure close-out surface for the web app.
 *
 * Every rule here already lives in `@weekspan/weekspan-core`'s `closeout.ts`
 * (`isCloseable`, `closeWeek`, `autoClose`, `unresolvedInWeek`) — this module
 * only reshapes that logic for a React panel: computing what to show, and
 * performing a close as a single call that never throws into a render path.
 *
 * Nothing here does I/O. `performClose` / `performAutoClose` return the next
 * `Weekspan` for `useWeekspan`'s `mutate(apply)`, plus the `ArchiveFile`(s)
 * that resulted. Persisting those archive files to `archive/<week>.json` is
 * the FileStore layer's job (another agent's chunk) — NOT this module's
 * responsibility. We only ever return the data.
 */

/**
 * One thing blocking (or that recently blocked) a week from closing.
 * Re-exported from core rather than redefined, so the `kind` discriminant
 * ('explicit' | 'generated') stays a single source of truth.
 */
export type Blocker = CloseBlocker

export interface CloseOutState {
  /** The oldest unclosed PAST week, or null when there's nothing to close (caught up). */
  week: IsoWeek | null
  closeable: boolean
  /**
   * Real dues the user set by hand. Always block. Remedy: complete or clear
   * them in the grid.
   */
  explicitBlockers: Blocker[]
  /**
   * Recurring occurrences with no explicit mark. Block a MANUAL close (the
   * forcing function) but not `autoClose`. Remedy: skip them in the grid, or
   * let auto-close resolve them on the next load.
   *
   * Kept in a SEPARATE array from `explicitBlockers` deliberately — core's
   * `closeout.ts` used to merge these into one list and a caller couldn't
   * tell "complete this" from "skip this." Do not re-merge them here.
   */
  generatedBlockers: Blocker[]
}

/**
 * Derive what the close-out panel should show for `weekspan` as of `today`.
 *
 * Mirrors `isCloseable`'s own past-week check (`weeksBetween(week,
 * currentWeek) <= 0` disqualifies the current/future week) so the two never
 * disagree about whether there's a week to close at all.
 */
export function closeOutState(weekspan: Weekspan, today: IsoDate): CloseOutState {
  const currentWeek = weekOf(today)
  const oldest = oldestUnclosedWeek(weekspan, today)

  if (weeksBetween(oldest, currentWeek) <= 0) {
    // The oldest unclosed week is the current week (or, in a clock-skew
    // scenario, beyond it): nothing is closeable, and there is no past week
    // to report on.
    return { week: null, closeable: false, explicitBlockers: [], generatedBlockers: [] }
  }

  const { explicitDues, generatedOccurrences } = unresolvedInWeek(weekspan, oldest)
  return {
    week: oldest,
    closeable: explicitDues.length === 0 && generatedOccurrences.length === 0,
    explicitBlockers: explicitDues,
    generatedBlockers: generatedOccurrences,
  }
}

/**
 * Close the oldest unclosed past week, if it's closeable.
 *
 * Returns `null` rather than throwing when there's nothing to close (no past
 * week, or the week is blocked) — a render path (a button's `onClick`) must
 * never have to try/catch a domain error just to stay a no-op. `closeOutState`
 * is what should have kept the confirm button from being reachable in the
 * blocked case; this is the second line of defense.
 */
export function performClose(
  weekspan: Weekspan,
  today: IsoDate,
): { weekspan: Weekspan; archived: Item[]; week: IsoWeek } | null {
  const state = closeOutState(weekspan, today)
  if (state.week === null || !state.closeable) return null

  // `state.week` is always the oldest unclosed week (that's what
  // `closeOutState` computed it from), so `closeWeek`'s sequential-close
  // invariant is satisfied by construction here.
  const { weekspan: next, archive } = closeWeek(weekspan, state.week, today)
  return { weekspan: next, archived: archive.items, week: state.week }
}

/**
 * Catch-up close every fully-past week, auto-skipping lapsed recurring
 * occurrences along the way (see `autoClose` in core, and ARCHITECTURE.md
 * "Auto-close"). Stops at the first week holding a real, unresolved explicit
 * due — that's genuine backlog and must stay visible rather than be skipped
 * past.
 *
 * Returns `null` when there is nothing to do, matching `useWeekspan`'s
 * `mutate(apply)` contract: `apply` returning `null` means "no change," which
 * writes nothing and produces no diff in a synced file.
 */
export function performAutoClose(
  weekspan: Weekspan,
  today: IsoDate,
): { weekspan: Weekspan; weeksClosed: IsoWeek[]; autoSkipped: number; archives: ArchiveFile[] } | null {
  const result = autoClose(weekspan, today)
  if (result.weeksClosed.length === 0) return null
  return result
}
