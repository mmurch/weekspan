/**
 * `weekspan-core` — all weekspan logic, no I/O.
 *
 * This package is consumed by three things: the browser app (File System Access
 * API), the CLI that agents drive, and eventually an MCP server. Every business
 * rule lives here exactly once, so an agent editing via the CLI cannot violate an
 * invariant the UI enforces, or vice versa.
 *
 * Nothing in here touches the filesystem, the network, or the clock. Every
 * function that needs "today" takes it as an argument — which is what makes the
 * date-dependent behaviour (windowing, recurrence display, auto-close) testable.
 */

export type {
  ArchiveFile,
  IsoDate,
  IsoWeek,
  Item,
  Weekspan,
  Link,
  Mark,
  MarkKind,
  Project,
  Recurrence,
  RecurrenceFreq,
  SkipProvenance,
} from './types.js'
export { AGENT_WARNING, SCHEMA_VERSION } from './types.js'

export { createArchive, createWeekspan } from './weekspan.js'

export {
  addDays,
  addWeeks,
  allWeekDates,
  daysBetween,
  fromDate,
  isValidIsoDate,
  isValidIsoWeek,
  isWeekend,
  toDate,
  weekEnd,
  weekOf,
  weekRange,
  weekStart,
  weekday,
  weekdayDates,
  weekendDates,
  weeksBetween,
} from './dates.js'

export { parseDateWord, tryParseDateWord } from './datewords.js'

export {
  RankError,
  byRank,
  initialRank,
  isValidRank,
  minimalMoveRank,
  orderItems,
  rankBetween,
  rankForInsert,
  rankSequence,
  siblingsOf,
} from './rank.js'

export {
  clearMark,
  getMark,
  hasMarkOfKind,
  latestMarkDate,
  markDates,
  marksInRange,
  setDone,
  setDue,
  setMark,
  setSkip,
} from './marks.js'

export {
  currentPeriod,
  nextOccurrence,
  occurrencesIn,
  occursOn,
  validateRecurrence,
} from './recurrence.js'

export type { DisplayState, RowStyle } from './derived.js'
export {
  displayState,
  effectiveMark,
  isArchivable,
  isFinished,
  isGeneratedOccurrence,
  rowStyle,
} from './derived.js'

export type { WeekWindow, WindowWeek } from './window.js'
export {
  computeWindow,
  isWeekInWindow,
  oldestUnclosedWeek,
  windowDateRange,
} from './window.js'

export type { CloseBlocker, CloseableResult } from './closeout.js'
export { autoClose, closeWeek, isCloseable, unresolvedInWeek } from './closeout.js'

export { SCHEMA_URI, serialize, serializeArchive } from './serialize.js'
export { FutureVersionError, ParseError, parse, parseArchive } from './parse.js'

export type { ConflictResolution, MergeConflict, MergeResult, MergeStats } from './merge.js'
export { deepEqual, isUnchanged, merge } from './merge.js'
