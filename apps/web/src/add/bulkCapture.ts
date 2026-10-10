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
 * feeding it unsplit text would let a due-word on one line claim a date
 * meant for another. Splitting first and parsing each line alone gives every
 * line its own independent due resolution, exactly as if it had been typed
 * alone into quick-capture.
 *
 * The project, like in single-item capture, is never inferred from the text
 * (see `capture.ts`). It is one explicit choice made in the overlay and
 * applied to every line of the batch — `commitBulk` takes it as an argument
 * rather than `parseBulk` finding it per line.
 */

import type { IsoDate, Weekspan } from '@weekspan/weekspan-core'
import { defaultInsertAnchor, siblingsOf } from '@weekspan/weekspan-core'
import { parseCapture } from './capture.js'
import { insertItem } from './draft.js'
import { normalizeTitle } from './normalizeTitle.js'

export interface BulkLine {
  /** The original, unprocessed line exactly as pasted. */
  raw: string
  /** Empty when `skipped` (blank line). */
  title: string
  due?: IsoDate
  /** True only for a line that produces no item (blank, or blank once markers/columns are stripped). */
  skipped: boolean
  /**
   * Human-readable note for the preview: why a line was skipped, or a
   * warning about a line that WILL still be created (currently just: extra
   * TSV columns dropped). Repeated titles are NOT flagged here — a
   * spreadsheet migration routinely has legitimate repeats ("call plumber"
   * on two different days is not a mistake), so duplicates are allowed
   * through with no warning at all, same as any other line.
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
 * Duplicate titles are deliberately NOT flagged or deduped — a migrated
 * todo list legitimately repeats titles ("call plumber" on two different
 * days), and the user pasted them on purpose. Every line is judged only on
 * whether it produces usable text, never on whether some other line looks
 * the same.
 */
export function parseBulk(text: string, today: IsoDate): BulkParse {
  const lines: BulkLine[] = []
  const seen = new Set<string>()

  for (const raw of splitLines(text)) {
    const columns = raw.split('\t')
    const nonEmptyColumns = columns.filter((c) => c.trim() !== '')
    const firstNonEmpty = columns.find((c) => c.trim() !== '')

    if (firstNonEmpty === undefined) {
      lines.push({ raw, title: '', skipped: true, reason: 'blank line' })
      continue
    }

    const stripped = stripListMarkers(firstNonEmpty.trim())
    const capture = parseCapture(stripped, today)
    const title = normalizeTitle(capture.title)

    if (title === '') {
      lines.push({ raw, title: '', skipped: true, reason: 'blank line' })
      continue
    }

    const line: BulkLine = { raw, title, skipped: false }
    if (capture.due !== undefined) line.due = capture.due
    if (nonEmptyColumns.length > 1) line.reason = 'extra columns ignored'
    // A repeated title is WARNED about, never blocked or deduped — "buy milk"
    // twice is legitimate. The failure this guards is different: pasting the
    // same spreadsheet column twice during a migration silently creates
    // hundreds of duplicates, and there is no undo. The user decides; the
    // preview just says what it noticed.
    else if (seen.has(title.toLowerCase())) line.reason = 'repeated in this paste'
    seen.add(title.toLowerCase())
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
 * `projectId`, when given, is applied to EVERY created item: it is the one
 * project ticked in the overlay, not something any line resolved for itself.
 * Omitted means the whole batch lands with no project, which is the default.
 *
 * Returns `null` when there is nothing to create (nothing creatable to begin
 * with, or every creatable line ends up failing to insert) — matching the
 * `mutate` no-op contract.
 */
export function commitBulk(
  weekspan: Weekspan,
  parse: BulkParse,
  position: 'top' | 'backlog',
  today: IsoDate,
  projectId?: string,
): Weekspan | null {
  const creatable = parse.lines.filter((l) => !l.skipped)
  if (creatable.length === 0) return null

  // Fixed for the whole batch, computed from the ORIGINAL roots — never
  // recomputed from `current`, since the point is that existing items don't
  // move and new items chain after each other, not after one another's
  // shifting neighbours.
  // BOTH ends, because a lone `beforeId` has no lower bound and would drop the
  // batch at the very top of the list rather than into the intended gap — see
  // `defaultInsertAnchor`.
  const anchor = position === 'top' ? defaultInsertAnchor(weekspan, today) : {}
  const beforeId = anchor.beforeId

  let current = weekspan
  let afterId: string | undefined =
    position === 'backlog' ? siblingsOf(weekspan.items, null).at(-1)?.id : anchor.afterId

  for (const line of creatable) {
    try {
      const result = insertItem(current, {
        title: line.title,
        ...(afterId !== undefined ? { afterId } : {}),
        ...(beforeId !== undefined ? { beforeId } : {}),
        ...(line.due !== undefined ? { due: line.due } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
      })
      current = result.weekspan
      afterId = result.id
    } catch {
      // Bad anchor or (defensively) a blank title — skip this line, keep going.
    }
  }

  return current === weekspan ? null : current
}
