import type { IsoDate, IsoWeek, Weekspan } from './types.js'
import { addWeeks, weekEnd, weekOf, weekStart, weekRange, weeksBetween } from './dates.js'

/**
 * The window: the bounded, pinned range of week blocks the grid renders
 * (see ARCHITECTURE.md "The window").
 *
 * There is no back-navigation in v1, so the window is a pure function of
 * `(weekspan, today)` rather than any client-side scroll state:
 *
 *  - Left edge = the oldest week not yet closed out. `closedThrough` is the
 *    last CLOSED week, so the oldest open one is `closedThrough + 1`. A
 *    fresh weekspan (`closedThrough: null`) has never closed anything, so it
 *    defaults to the week before the current one — last week dimmed, exactly
 *    as the design draws a new user's grid.
 *
 *  - Right edge = `max(currentWeek + 2, leftEdge + 3)`. The first term is
 *    the design's "this week and the two following." The second guarantees
 *    at least four blocks even when the user is fully caught up and last
 *    week has already closed away — without it, closing last week would
 *    silently shrink the grid to three blocks.
 *
 * The window GROWS LEFTWARD when the user is behind: there is no cap on how
 * many weeks it can span. Hiding backlog would defeat the point of the grid
 * (see ARCHITECTURE.md "Variable width when behind").
 */

export interface WindowWeek {
  week: IsoWeek
  /** Strictly before the current week -> gets pastTint. */
  isPast: boolean
  isCurrent: boolean
  isFuture: boolean
  /** The only week that may show the close affordance. */
  isOldestUnclosed: boolean
}

export interface WeekWindow {
  weeks: WindowWeek[]
  from: IsoWeek
  to: IsoWeek
  currentWeek: IsoWeek
  today: IsoDate
}

/**
 * True when nothing has ever been recorded before `date`.
 *
 * Explicit marks only. A recurring rule with an anchor in the past would
 * "fire" through all of history, which would make every new file look like it
 * had a backlog on day one — the opposite of what a fresh file is.
 */
function hasMarksBefore(weekspan: Weekspan, date: IsoDate): boolean {
  for (const item of weekspan.items) {
    for (const markDate of Object.keys(item.marks)) {
      if (markDate < date) return true
    }
  }
  return false
}

/**
 * The window's left edge: the oldest week not yet closed out.
 *
 * A brand-new weekspan starts at the CURRENT week, not the one before it.
 * `closedThrough` is null on a fresh file, which used to mean "last week is
 * unclosed" and put an empty, uncloseable past week on screen before the user
 * had entered anything — the app opened looking like it was already behind.
 * With nothing recorded before this week there is, by definition, nothing there
 * to close, so the honest left edge is this week. This is a display rule, not a
 * close-out: `closedThrough` is not written, nothing is archived, and the
 * moment a mark exists in a past week the edge moves back to include it (which
 * is what happens naturally next week, so the week you just used stays visible
 * and closeable).
 *
 * Clamped so it never exceeds `currentWeek` — `closedThrough` at or beyond
 * the current week (clock skew, a hand-edited file, travel across
 * timezones) must not push the left edge into the future and invert the
 * range. In that case the left edge just IS the current week.
 */
export function oldestUnclosedWeek(weekspan: Weekspan, today: IsoDate): IsoWeek {
  const currentWeek = weekOf(today)
  if (weekspan.closedThrough === null && !hasMarksBefore(weekspan, weekStart(currentWeek))) {
    return currentWeek
  }
  const naive = weekspan.closedThrough === null ? addWeeks(currentWeek, -1) : addWeeks(weekspan.closedThrough, 1)
  return weeksBetween(currentWeek, naive) > 0 ? currentWeek : naive
}

export function computeWindow(weekspan: Weekspan, today: IsoDate): WeekWindow {
  const currentWeek = weekOf(today)
  const from = oldestUnclosedWeek(weekspan, today)

  const rightFromCurrent = addWeeks(currentWeek, 2)
  const rightFromLeft = addWeeks(from, 3)
  const to = weeksBetween(rightFromCurrent, rightFromLeft) > 0 ? rightFromLeft : rightFromCurrent

  const weeks: WindowWeek[] = weekRange(from, to).map((week, index) => {
    const cmp = weeksBetween(currentWeek, week)
    return {
      week,
      isPast: cmp < 0,
      isCurrent: cmp === 0,
      isFuture: cmp > 0,
      isOldestUnclosed: index === 0,
    }
  })

  return { weeks, from, to, currentWeek, today }
}

export function isWeekInWindow(window: WeekWindow, week: IsoWeek): boolean {
  return weeksBetween(window.from, week) >= 0 && weeksBetween(week, window.to) >= 0
}

/** Monday of the first week through Sunday of the last, for occurrence generation. */
export function windowDateRange(window: WeekWindow): { from: IsoDate; to: IsoDate } {
  return { from: weekStart(window.from), to: weekEnd(window.to) }
}
