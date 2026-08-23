/**
 * Pure view-model layer for the Weekspan priority grid.
 *
 * `buildGrid(weekspan, today)` turns domain state into the exact structure the
 * renderer walks: one `WeekBlock` per week in the window, one `RowVM` per item
 * (parents immediately followed by their children), and one `CellVM` per row
 * per date. No React, no DOM, no clock, no I/O — every date-dependent fact
 * comes from the `today` argument, which is what makes this testable without
 * a browser.
 *
 * All domain logic (windowing, ordering, mark resolution, recurrence,
 * close-out eligibility) is delegated to `@weekspan/weekspan-core`. Nothing
 * here reimplements a rule that package already owns.
 */

import type {
  DisplayState,
  IsoDate,
  IsoWeek,
  Item,
  Link,
  RowStyle,
  Weekspan,
} from '@weekspan/weekspan-core'
import {
  addDays,
  addWeeks,
  computeWindow,
  daysBetween,
  displayState,
  effectiveMark,
  isCloseable,
  isGeneratedOccurrence,
  isWeekend,
  orderItems,
  rowStyle,
  weekday,
  weekdayDates,
  weekEnd,
  weekendDates,
  weekOf,
  weekStart,
  windowDateRange,
} from '@weekspan/weekspan-core'

export interface DayColumn {
  date: IsoDate
  /** M T W TH F for weekdays, S S for the weekend block. TH is deliberately two characters. */
  letter: string
  /** Zero-padded day-of-month, e.g. "24". */
  dayOfMonth: string
  isToday: boolean
  isVacation: boolean
  isWeekend: boolean
}

export interface WeekBlock {
  week: IsoWeek
  /** "W35" */
  label: string
  /** "Aug 24 – 30", or "Aug 31 – Sep 6" across a month boundary. */
  range: string
  weekdays: DayColumn[]
  weekend: DayColumn[]
  isPast: boolean
  isCurrent: boolean
  isOldestUnclosed: boolean
  /** True when this week may actually be closed right now. */
  closeable: boolean
  /**
   * Whether to render the close affordance at all.
   *
   * The handoff said the `×` appears only when a week is closeable and is
   * "rendered absent" otherwise. In use that proved undiscoverable: a blocked
   * week showed nothing, so there was no way to find out WHAT was blocking it —
   * you had to already know. The affordance now appears on the oldest unclosed
   * past week regardless, and clicking it either confirms the close or explains
   * the blockers. Deliberate deviation from the handoff.
   */
  showClose: boolean
}

export interface CellVM {
  date: IsoDate
  kind: 'due' | 'done' | 'skip' | null
  /** True when this cell's due-ness came from a recurrence rule, not an explicit mark. */
  generated: boolean
  isToday: boolean
  isVacation: boolean
  isWeekend: boolean
  isPastWeek: boolean
}

export interface RowVM {
  id: string
  title: string
  notes?: string
  depth: 0 | 1
  state: DisplayState
  style: RowStyle
  /** 'barA' | 'barB' | ... resolved from the item's project. Null if none or missing. */
  projectColorToken: string | null
  recurring: boolean
  links: Link[]
  /** One per date across the whole window, in the same order as `GridVM.dates`. */
  cells: CellVM[]
}

export interface GridVM {
  weeks: WeekBlock[]
  rows: RowVM[]
  /** Every date in the window, ordered. `RowVM.cells` aligns to this positionally. */
  dates: IsoDate[]
  today: IsoDate
  currentWeek: IsoWeek
  itemColumnWidth: number
  totalDayColumns: number
}

const WEEKDAY_LETTERS: Record<number, string> = {
  1: 'M',
  2: 'T',
  3: 'W',
  4: 'TH',
  5: 'F',
  6: 'S',
  7: 'S',
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function dayLetter(date: IsoDate): string {
  return WEEKDAY_LETTERS[weekday(date)] ?? ''
}

function weekLabel(week: IsoWeek): string {
  return week.slice(week.indexOf('-') + 1)
}

function formatWeekRange(week: IsoWeek): string {
  const start = weekStart(week)
  const end = weekEnd(week)
  const startMonth = Number(start.slice(5, 7)) - 1
  const endMonth = Number(end.slice(5, 7)) - 1
  const startDay = Number(start.slice(8, 10))
  const endDay = Number(end.slice(8, 10))

  if (startMonth === endMonth) {
    return `${MONTH_ABBR[startMonth]} ${startDay} – ${endDay}`
  }
  return `${MONTH_ABBR[startMonth]} ${startDay} – ${MONTH_ABBR[endMonth]} ${endDay}`
}

function buildDayColumn(date: IsoDate, weekspan: Weekspan, today: IsoDate): DayColumn {
  return {
    date,
    letter: dayLetter(date),
    dayOfMonth: date.slice(8, 10),
    isToday: date === today,
    isVacation: weekspan.vacationDays.includes(date),
    isWeekend: isWeekend(date),
  }
}

function buildWeekBlock(
  weekspan: Weekspan,
  w: { week: IsoWeek; isPast: boolean; isCurrent: boolean; isOldestUnclosed: boolean },
  today: IsoDate,
): WeekBlock {
  const weekdays = weekdayDates(w.week).map((d) => buildDayColumn(d, weekspan, today))
  const weekend = weekendDates(w.week).map((d) => buildDayColumn(d, weekspan, today))

  // `isCloseable` alone doesn't know about close-out's strict sequencing (only the
  // oldest unclosed week may ever close), so we scope it with the window's own flag
  // rather than let a resolved-but-not-oldest past week claim the close affordance.
  const closeable = w.isOldestUnclosed && isCloseable(weekspan, w.week, today).closeable
  // Past-and-oldest is what earns the affordance; closeable only decides whether
  // clicking it closes or explains.
  const showClose = w.isOldestUnclosed && w.isPast

  return {
    week: w.week,
    label: weekLabel(w.week),
    range: formatWeekRange(w.week),
    weekdays,
    weekend,
    isPast: w.isPast,
    isCurrent: w.isCurrent,
    isOldestUnclosed: w.isOldestUnclosed,
    closeable,
    showClose,
  }
}

function buildCell(
  item: Item,
  date: IsoDate,
  today: IsoDate,
  weekspan: Weekspan,
  pastByWeek: Map<IsoWeek, boolean>,
): CellVM {
  const mark = effectiveMark(item, date)
  return {
    date,
    kind: mark ? mark.kind : null,
    generated: isGeneratedOccurrence(item, date),
    isToday: date === today,
    isVacation: weekspan.vacationDays.includes(date),
    isWeekend: isWeekend(date),
    isPastWeek: pastByWeek.get(weekOf(date)) ?? false,
  }
}

function buildRow(
  item: Item,
  dates: readonly IsoDate[],
  today: IsoDate,
  weekspan: Weekspan,
  pastByWeek: Map<IsoWeek, boolean>,
  projectColorById: Map<string, string>,
): RowVM {
  const state = displayState(item, today)

  const projectColorToken =
    item.projectId != null ? (projectColorById.get(item.projectId) ?? null) : null

  const row: RowVM = {
    id: item.id,
    title: item.title,
    depth: item.parentId == null ? 0 : 1,
    state,
    style: rowStyle(state),
    projectColorToken,
    recurring: item.recurrence != null,
    links: item.links ?? [],
    cells: dates.map((date) => buildCell(item, date, today, weekspan, pastByWeek)),
  }
  // `notes` must be omitted rather than set to `undefined` — exactOptionalPropertyTypes
  // treats those as distinct, and the renderer should be able to rely on `in row`.
  if (item.notes !== undefined) row.notes = item.notes
  return row
}

/**
 * Turn `(weekspan, today)` into the structure the grid renderer walks.
 *
 * All windowing, ordering, and cell-resolution rules come from
 * `@weekspan/weekspan-core` — this function only shapes their output.
 */
/**
 * `minWeeks` extends the window to the RIGHT so the grid can fill a wide screen.
 *
 * It never trims: weekspan-core owns the left edge (the oldest unclosed week) and
 * the four-week floor, and both are domain rules rather than presentation. This
 * only adds future weeks, which are always safe to show.
 */

/**
 * Core's window plus enough trailing future weeks to reach `minWeeks`.
 *
 * Built by extending core's result rather than recomputing, so the left edge and
 * every per-week flag stay exactly what the domain decided.
 */
function computeWindowExtended(
  weekspan: Weekspan,
  today: IsoDate,
  minWeeks: number,
): ReturnType<typeof computeWindow> {
  const base = computeWindow(weekspan, today)
  const weeks = [...base.weeks]
  while (weeks.length < minWeeks) {
    const next = addWeeks(weeks[weeks.length - 1]!.week, 1)
    weeks.push({
      week: next,
      isPast: false,
      isCurrent: false,
      isFuture: true,
      isOldestUnclosed: false,
    })
  }
  return { ...base, weeks, to: weeks[weeks.length - 1]!.week }
}

export function buildGrid(weekspan: Weekspan, today: IsoDate, minWeeks = 0): GridVM {
  const base = computeWindow(weekspan, today)
  const window =
    minWeeks > base.weeks.length
      ? computeWindowExtended(weekspan, today, minWeeks)
      : base

  const { from, to } = windowDateRange(window)
  const span = daysBetween(from, to)
  const dates: IsoDate[] = []
  for (let i = 0; i <= span; i++) dates.push(addDays(from, i))

  const pastByWeek = new Map<IsoWeek, boolean>(window.weeks.map((w) => [w.week, w.isPast]))

  const weeks: WeekBlock[] = window.weeks.map((w) => buildWeekBlock(weekspan, w, today))

  const projectColorById = new Map<string, string>(
    weekspan.projects.map((p) => [p.id, p.colorToken]),
  )
  const ordered = orderItems(weekspan.items)
  const rows: RowVM[] = ordered.map((item) =>
    buildRow(item, dates, today, weekspan, pastByWeek, projectColorById),
  )

  return {
    weeks,
    rows,
    dates,
    today,
    currentWeek: window.currentWeek,
    itemColumnWidth: 360,
    totalDayColumns: dates.length,
  }
}
