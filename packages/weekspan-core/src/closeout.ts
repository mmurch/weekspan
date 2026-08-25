import type { ArchiveFile, IsoDate, IsoWeek, Item, Weekspan } from './types.js'
import { getMark, setSkip } from './marks.js'
import { occurrencesIn } from './recurrence.js'
import { isArchivable, isGeneratedOccurrence } from './derived.js'
import { oldestUnclosedWeek } from './window.js'
import { weekEnd, weekStart, weekOf, weeksBetween } from './dates.js'

/**
 * Close-out: the storage boundary where a week's worth of resolved due marks
 * gets archived out of the working file. See ARCHITECTURE.md "Close-out" and
 * "Auto-close".
 *
 * Every function here is pure — inputs are never mutated, a new `Weekspan` is
 * returned on every close.
 */

export interface CloseBlocker {
  itemId: string
  date: IsoDate
  title: string
  /**
   * `explicit`  — a due the user set by hand. Always blocks, and `autoClose` stops here.
   * `generated` — an occurrence produced by a recurrence rule. Blocks a MANUAL close (the
   *               forcing function), but `autoClose` resolves it to an auto-skip instead.
   */
  kind: 'explicit' | 'generated'
}

export interface CloseableResult {
  closeable: boolean
  blockers: CloseBlocker[]
}

/**
 * Unresolved due-ness in `week`, split by source.
 *
 * `explicitDues` — items with an explicit `{ kind: 'due' }` mark sitting on a
 * date in the week. These always block close-out; they're backlog the user
 * planned and didn't do.
 *
 * `generatedOccurrences` — dates in the week where a recurring item's rule
 * fires but there is no explicit mark. These block manual close-out (the
 * forcing function) but are exactly what `autoClose` auto-skips during
 * catch-up rather than treating as a blocker.
 *
 * Both use the WEEK's full seven days (`allWeekDates`), not just the
 * weekday columns the grid renders — a due or a recurring occurrence on a
 * weekend still has to be resolved before the week can close.
 *
 * Vacation days drop out of `generatedOccurrences` (via
 * `isGeneratedOccurrence`) but NOT out of `explicitDues`. A rule that fires
 * on a day the user was away never became work, so it must not block the
 * close or earn an auto-skip; a due the user placed by hand IS work they
 * planned, and marking the day vacation afterwards doesn't retract it.
 */
export function unresolvedInWeek(
  weekspan: Weekspan,
  week: IsoWeek,
): { explicitDues: CloseBlocker[]; generatedOccurrences: CloseBlocker[] } {
  const from = weekStart(week)
  const to = weekEnd(week)

  const explicitDues: CloseBlocker[] = []
  const generatedOccurrences: CloseBlocker[] = []

  for (const item of weekspan.items) {
    // Explicit dues: scan the item's own marks in range, cheaper than scanning every date.
    for (const [date, mark] of Object.entries(item.marks)) {
      if (date < from || date > to) continue
      if (mark.kind === 'due') {
        explicitDues.push({ itemId: item.id, date, title: item.title, kind: 'explicit' })
      }
    }

    if (item.recurrence) {
      const occurrences = occurrencesIn(item.recurrence, from, to)
      for (const date of occurrences) {
        if (isGeneratedOccurrence(item, date, weekspan.vacationDays)) {
          generatedOccurrences.push({
            itemId: item.id,
            date,
            title: item.title,
            kind: 'generated',
          })
        }
      }
    }
  }

  explicitDues.sort((a, b) => (a.date === b.date ? a.itemId.localeCompare(b.itemId) : a.date < b.date ? -1 : 1))
  generatedOccurrences.sort((a, b) =>
    a.date === b.date ? a.itemId.localeCompare(b.itemId) : a.date < b.date ? -1 : 1,
  )

  return { explicitDues, generatedOccurrences }
}

/**
 * Whether `week` may be closed as of `today`: it must be strictly in the past, and
 * every due mark in it — explicit or generated — must be resolved.
 *
 * `blockers` reports EVERYTHING that blocks, tagged by `kind`. An earlier version
 * returned only explicit dues, which let `closeable: false` coexist with an empty
 * blocker list — a caller could render "cannot close, nothing is blocking", and
 * `closeWeek` fell through to a misleading "current or future week" error. Callers
 * that only care about human-actionable backlog should filter on `kind === 'explicit'`.
 */
export function isCloseable(weekspan: Weekspan, week: IsoWeek, today: IsoDate): CloseableResult {
  const currentWeek = weekOf(today)
  if (weeksBetween(week, currentWeek) <= 0) {
    // week is the current week or a future week: never closeable.
    return { closeable: false, blockers: [] }
  }

  const { explicitDues, generatedOccurrences } = unresolvedInWeek(weekspan, week)
  const blockers = [...explicitDues, ...generatedOccurrences]
  return { closeable: blockers.length === 0, blockers }
}

function requireOldestUnclosed(weekspan: Weekspan, week: IsoWeek, today: IsoDate): void {
  const oldest = oldestUnclosedWeek(weekspan, today)
  if (week !== oldest) {
    throw new Error(
      `Cannot close ${week}: close-out is strictly sequential and the oldest unclosed week is ${oldest}`,
    )
  }
}

/**
 * Close `week`: archive out every archivable item (finished, non-recurring,
 * latest mark on or before the week's end) and advance `closedThrough`.
 *
 * Throws if `week` is not closeable (see `isCloseable`) or is not the oldest
 * unclosed week (close-out is strictly sequential — see ARCHITECTURE.md
 * "Close-out"). Pure: `weekspan` is never mutated, a new `Weekspan` is returned.
 */
export function closeWeek(
  weekspan: Weekspan,
  week: IsoWeek,
  today: IsoDate,
): { weekspan: Weekspan; archive: ArchiveFile } {
  requireOldestUnclosed(weekspan, week, today)

  const { closeable, blockers } = isCloseable(weekspan, week, today)
  if (!closeable) {
    const [first] = blockers
    const reason = first
      ? `unresolved ${first.kind} due "${first.title}" (${first.itemId}) on ${first.date}`
      : 'it is the current or a future week'
    throw new Error(`Cannot close ${week}: ${reason}`)
  }

  const end = weekEnd(week)
  const archived: Item[] = []
  const remaining: Item[] = []
  for (const item of weekspan.items) {
    if (isArchivable(item, end)) {
      archived.push(item)
    } else {
      remaining.push(item)
    }
  }

  const newWeekspan: Weekspan = {
    ...weekspan,
    closedThrough: week,
    items: remaining,
  }

  const archive: ArchiveFile = {
    version: weekspan.version,
    week,
    items: archived,
  }

  return { weekspan: newWeekspan, archive }
}

/** Hard cap on weeks `autoClose` will iterate — see its doc comment. */
const AUTO_CLOSE_MAX_WEEKS = 10_000

/**
 * Catch-up close-out: walk forward from the oldest unclosed week, closing
 * every week that's fully in the past, while it's fully in the past.
 *
 * For each such week:
 *  1. If it holds any unresolved EXPLICIT due, stop entirely — that's real
 *     backlog the user planned and didn't do, and it must stay visible
 *     rather than be silently skipped or silently blocked past.
 *  2. Otherwise, every unresolved GENERATED recurring occurrence in the week
 *     gets `setSkip(item, date, 'auto')`, then the week closes.
 *
 * This is the "returning to a neglected weekspan must never cost more than a
 * glance" principle (ARCHITECTURE.md "Auto-close"): recurring occurrences
 * fire every week whether the user is present or not, so blocking on them
 * would punish absence rather than avoidance. The `'auto'` provenance (never
 * `'deliberate'`) is what lets a later skip-streak feature ignore these —
 * mislabelling them would make three months away look identical to three
 * months of dodging the task.
 *
 * Guarded with a hard iteration cap so a hand-edited `closedThrough` far in
 * the future (or any other clock-skew scenario) fails loudly with an error
 * rather than looping silently or forever.
 */
export function autoClose(
  weekspan: Weekspan,
  today: IsoDate,
): { weekspan: Weekspan; archives: ArchiveFile[]; weeksClosed: IsoWeek[]; autoSkipped: number } {
  let current = weekspan
  const archives: ArchiveFile[] = []
  const weeksClosed: IsoWeek[] = []
  let autoSkipped = 0

  const currentWeek = weekOf(today)

  for (let i = 0; i < AUTO_CLOSE_MAX_WEEKS; i++) {
    const week = oldestUnclosedWeek(current, today)
    if (weeksBetween(week, currentWeek) <= 0) {
      // week is the current week or (shouldn't happen) beyond: nothing more to auto-close.
      return { weekspan: current, archives, weeksClosed, autoSkipped }
    }

    const { explicitDues, generatedOccurrences } = unresolvedInWeek(current, week)
    if (explicitDues.length > 0) {
      // Real backlog: stop here, leave this week (and everything after) open.
      return { weekspan: current, archives, weeksClosed, autoSkipped }
    }

    let skippedItems = current.items
    if (generatedOccurrences.length > 0) {
      const byId = new Map(skippedItems.map((item) => [item.id, item] as const))
      for (const blocker of generatedOccurrences) {
        const item = byId.get(blocker.itemId)
        if (!item) continue
        // Belt-and-suspenders: only auto-skip dates still unresolved (no explicit mark).
        if (getMark(item, blocker.date)) continue
        const updated = setSkip(item, blocker.date, 'auto')
        byId.set(item.id, updated)
        autoSkipped++
      }
      skippedItems = current.items.map((item) => byId.get(item.id) ?? item)
    }

    const beforeClose: Weekspan = { ...current, items: skippedItems }
    const { weekspan: closedWeekspan, archive } = closeWeek(beforeClose, week, today)

    current = closedWeekspan
    archives.push(archive)
    weeksClosed.push(week)
  }

  throw new Error(
    `autoClose exceeded ${AUTO_CLOSE_MAX_WEEKS} iterations without reaching the current week — ` +
      `check for a corrupt or far-future closedThrough pointer`,
  )
}
