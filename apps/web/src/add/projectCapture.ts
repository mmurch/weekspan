/**
 * Commit path for quick-capture's project-creation mode (⌘⏎ / the "Project"
 * checkbox in `QuickCapture`).
 *
 * `addProject` (from `@weekspan/weekspan-core`) throws on a blank or
 * duplicate name — the right contract for a programmatic caller, but a throw
 * inside a React commit path (`store.mutate(apply)`) would take the whole app
 * down rather than just refusing the write. This wraps it to match the
 * `mutate(apply)` contract used everywhere else in quick-capture
 * (`insertItem`/`updateTitle` in `draft.ts`): return `null` for "write
 * nothing" instead of throwing.
 */

import type { Weekspan } from '@weekspan/weekspan-core'
import { addProject, nextProjectColor } from '@weekspan/weekspan-core'

/**
 * Create a project named `name` in `weekspan`, or return `null` if `name` is
 * blank/whitespace-only or already names a project (case-insensitively —
 * "Groceries" and "groceries" must not both exist).
 *
 * The case-insensitive duplicate check is done here rather than left to
 * `addProject`'s own throw, so this function's behaviour doesn't depend on
 * exactly how case-sensitive that guard turns out to be.
 */
export function commitProjectCapture(weekspan: Weekspan, name: string): Weekspan | null {
  const trimmed = name.trim()
  if (trimmed === '') return null

  const lower = trimmed.toLowerCase()
  if (weekspan.projects.some((p) => p.name.toLowerCase() === lower)) return null

  try {
    return addProject(weekspan, trimmed, nextProjectColor(weekspan)).weekspan
  } catch {
    // Belt-and-braces: addProject throws on blank/duplicate too, but the
    // check above already covers both cases against this function's own
    // (case-insensitive) definition of "duplicate".
    return null
  }
}
