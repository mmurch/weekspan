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
 * The window's left edge: the oldest week not yet closed out.
 *
 * Clamped so it never exceeds `currentWeek` — `closedThrough` at or beyond
 * the current week (clock skew, a hand-edited file, travel across
 * timezones) must not push the left edge into the future and invert the
 * range. In that case the left edge just IS the current week.
 */
export function oldestUnclosedWeek(weekspan: Weekspan, today: IsoDate): IsoWeek {
  const currentWeek = weekOf(today)
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
