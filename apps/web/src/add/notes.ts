/**
 * Notes: markdown bullets under a title. See `Item.notes` in weekspan-core's
 * `types.ts` — "Markdown. Bullet lists render under the title."
 *
 * Same shape as `commitEdit`/`updateTitle`: pure, no store, no DOM. `notesToLines`
 * / `linesToNotes` are the round-trip pair that keeps what's on disk consistent
 * regardless of whether the user typed a leading `-` — retyping the same content
 * with different dashes must be a no-op, not a spurious diff.
 */

import type { Weekspan } from '@weekspan/weekspan-core'

/**
 * Splits raw notes text (either the stored `- ` form or freehand lines typed
 * into an editor) into trimmed, non-empty lines with any leading bullet
 * marker (`-` or `*`, with or without a following space) stripped.
 */
export function notesToLines(notes: string | undefined): string[] {
  if (!notes) return []
  return notes
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s?/, '').trim())
    .filter((line) => line.length > 0)
}

/** Joins lines back into the stored form: one `- text` bullet per line. */
export function linesToNotes(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}

/**
 * Commit an edit to an item's notes.
 *
 * Normalises on write — every non-empty line becomes `- text` regardless of
 * whether the user typed the dash — and compares NORMALISED forms so retyping
 * the same content with different dashes is correctly a no-op (returns null,
 * matching the `mutate` no-write contract).
 *
 * Clearing all notes removes the `notes` field entirely rather than storing an
 * empty string, which would serialize as a meaningless key and show up as a
 * spurious diff in a synced file.
 *
 * Returns null (rather than throwing) when `itemId` does not resolve — same
 * "refuse to write" posture as the rest of this module's callers.
 */
export function commitNotes(weekspan: Weekspan, itemId: string, notes: string): Weekspan | null {
  const item = weekspan.items.find((i) => i.id === itemId)
  if (!item) return null

  const nextLines = notesToLines(notes)
  const nextNormalized = nextLines.length > 0 ? linesToNotes(nextLines) : undefined

  const currentLines = notesToLines(item.notes)
  const currentNormalized = currentLines.length > 0 ? linesToNotes(currentLines) : undefined

  if (nextNormalized === currentNormalized) return null

  const nextItem = { ...item }
  if (nextNormalized === undefined) delete nextItem.notes
  else nextItem.notes = nextNormalized

  return {
    ...weekspan,
    items: weekspan.items.map((i) => (i.id === itemId ? nextItem : i)),
  }
}
