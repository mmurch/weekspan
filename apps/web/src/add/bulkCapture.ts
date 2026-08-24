/**
 * Bulk paste import — turn a pasted block of lines (migrating an existing
 * spreadsheet todo list is the whole reason this exists) into a batch of
 * items in one shot.
 *
 * `parseBulk` is pure and does no writing: it is what quick-capture calls on
 * every keystroke to render the import preview. `commitBulk` is the one
 * place that actually turns a `BulkParse` into a new `Weekspan`, mirroring
 * `commitEdit`'s shape (`(weekspan, ...) => Weekspan | null`) so the caller
 * can hand it straight to `store.mutate`.
 *
 * Each line is run through `parseCapture` INDIVIDUALLY, never the whole
 * pasted blob at once — `parseCapture` treats a newline as ordinary
 * whitespace (quick-capture's own multi-line titles rely on that), so
 * feeding it unsplit text would let a due-word on one line resolve a
 * project mentioned three lines later. Splitting first and parsing each
 * line alone gives every line its own independent due/project resolution,
 * exactly as if it had been typed alone into quick-capture.
 */

import type { IsoDate, Project, Weekspan } from '@weekspan/weekspan-core'
import { assignProject, siblingsOf } from '@weekspan/weekspan-core'
import { parseCapture } from './capture.js'
import { insertItem } from './draft.js'
import { normalizeTitle } from './normalizeTitle.js'

export interface BulkLine {
  /** The original, unprocessed line exactly as pasted. */
  raw: string
  /** Empty when `skipped` (blank line). */
  title: string
  due?: IsoDate
  projectId?: string
  /** True only for a line that produces no item (blank, or blank once markers/columns are stripped). */
  skipped: boolean
  /**
   * Human-readable note for the preview: why a line was skipped, or a
   * warning about a line that WILL still be created (extra TSV columns
   * dropped, a title that repeats an earlier line in this same paste).
   */
  reason?: string
}

export interface BulkParse {
  lines: BulkLine[]
  createCount: number
}

// A sheet or doc export routinely carries these; an item literally titled
// "- buy milk" would be wrong. Applied in a loop so a stacked marker (e.g.
// markdown's "- [ ] buy milk") is fully stripped, not just its outer layer.
// `\s*` up front tolerates leading padding; the marker itself requires
// trailing whitespace UNLESS it's the last thing on the line (a line that's
// bare "- " with nothing after it must still count as fully stripped, not
// stall with a dangling "-").
const LIST_MARKER_RE = /^\s*(?:[-*](?:\s+|$)|\d+[.)](?:\s+|$)|\[[ xX]\](?:\s+|$))/

function stripListMarkers(text: string): string {
  let out = text
  while (LIST_MARKER_RE.test(out)) {
    out = out.replace(LIST_MARKER_RE, '')
  }
  return out
}

// Splits on any line ending a spreadsheet/doc export might use.
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/**
 * Parse pasted text into per-line results, ready for the import preview.
 *
 * Spreadsheet paste is TSV: copying a range out of Google Sheets hands the
 * clipboard tab-separated columns. Only the first NON-EMPTY column becomes
 * the line's text; the rest is dropped — but a line is flagged (`reason`,
 * `skipped: false`) whenever more than one of its columns actually had
 * content, so discarding it is visible in the preview rather than a silent
 * surprise.
 *
 * A title that repeats an earlier CREATABLE line's title (case-insensitive)
 * is flagged as a possible duplicate but still created — this never
 * compares against existing items in the weekspan (deliberately: this
 * function doesn't even receive one), only against the rest of the same
 * paste. The user decides; this just warns.
 */
export function parseBulk(text: string, projects: readonly Project[], today: IsoDate): BulkParse {
  const lines: BulkLine[] = []
  const seenTitles = new Set<string>()

  for (const raw of splitLines(text)) {
    const columns = raw.split('\t')
    const nonEmptyColumns = columns.filter((c) => c.trim() !== '')
    const firstNonEmpty = columns.find((c) => c.trim() !== '')

    if (firstNonEmpty === undefined) {
      lines.push({ raw, title: '', skipped: true, reason: 'blank line' })
      continue
    }

    const stripped = stripListMarkers(firstNonEmpty.trim())
    const capture = parseCapture(stripped, projects, today)
    const title = normalizeTitle(capture.title)

    if (title === '') {
      lines.push({ raw, title: '', skipped: true, reason: 'blank line' })
      continue
    }

    const reasons: string[] = []
    if (nonEmptyColumns.length > 1) reasons.push('extra columns ignored')
    const key = title.toLowerCase()
    if (seenTitles.has(key)) reasons.push('possible duplicate')
    seenTitles.add(key)

    const line: BulkLine = { raw, title, skipped: false }
    if (capture.due !== undefined) line.due = capture.due
    if (capture.projectId !== undefined) line.projectId = capture.projectId
    if (reasons.length > 0) line.reason = reasons.join('; ')
    lines.push(line)
  }

  return { lines, createCount: lines.filter((l) => !l.skipped).length }
}

/**
 * Commit a `BulkParse` as ONE new weekspan — never N, so the caller's single
 * `mutate` call produces a single file write (N writes would mean N syncs
 * and N chances to conflict).
 *
 * Every creatable line is inserted as a new root item via `insertItem`,
 * chained so paste order is preserved: each line anchors `afterId` to the
 * PREVIOUSLY inserted line (not to any existing item), so line 2 always
 * lands immediately after line 1 regardless of how many existing items sit
 * nearby. `position: 'top'` additionally pins every insert's `beforeId` to
 * whatever WAS the first existing root (fixed for the whole batch — new
 * items never move each other around, and the original first root never
 * moves either); `'backlog'` leaves the upper bound open and simply appends
 * after the original last root.
 *
 * `insertItem` throws on a bad anchor or a blank title; each line is
 * inserted in its own try/catch so one bad line is skipped rather than
 * aborting the whole import or letting the throw escape into a render.
 *
 * Returns `null` when there is nothing to create (nothing creatable to begin
 * with, or every creatable line ends up failing to insert) — matching the
 * `mutate` no-op contract.
 */
export function commitBulk(
  weekspan: Weekspan,
  parse: BulkParse,
  position: 'top' | 'backlog',
): Weekspan | null {
  const creatable = parse.lines.filter((l) => !l.skipped)
  if (creatable.length === 0) return null

  // Fixed for the whole batch, computed from the ORIGINAL roots — never
  // recomputed from `current`, since the point is that existing items don't
  // move and new items chain after each other, not after one another's
  // shifting neighbours.
  const beforeId = position === 'top' ? siblingsOf(weekspan.items, null)[0]?.id : undefined

  let current = weekspan
  let afterId: string | undefined =
    position === 'backlog' ? siblingsOf(weekspan.items, null).at(-1)?.id : undefined

  for (const line of creatable) {
    try {
      const result = insertItem(current, {
        title: line.title,
        ...(afterId !== undefined ? { afterId } : {}),
        ...(beforeId !== undefined ? { beforeId } : {}),
        ...(line.due !== undefined ? { due: line.due } : {}),
      })
      // `insertItem`'s `InsertOpts` has no `projectId` field — it only ever
      // sets a `due` mark. `assignProject` is the actual (and only) way to
      // put a new item in a project, so it's applied as a second step here
      // rather than folded into the insert options.
      current =
        line.projectId !== undefined
          ? (assignProject(result.weekspan, result.id, line.projectId) ?? result.weekspan)
          : result.weekspan
      afterId = result.id
    } catch {
      // Bad anchor or (defensively) a blank title — skip this line, keep going.
    }
  }

  return current === weekspan ? null : current
}
