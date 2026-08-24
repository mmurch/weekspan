import type { Weekspan } from '@weekspan/weekspan-core'
import { insertItem, updateTitle } from './draft.js'

/**
 * Editing an existing title and typing a brand-new item are the SAME
 * interaction — you click into the list and type. One commit path, two entry
 * points, so they cannot drift apart in feel or in behaviour.
 */

export type EditTarget =
  | { kind: 'existing'; itemId: string }
  | { kind: 'new'; afterId: string | null; beforeId: string | null; parentId: string | null }

/**
 * Returns the next weekspan, or null for any no-op — matching the `mutate`
 * contract, so an unchanged title or an abandoned draft writes nothing at all.
 */
export function commitEdit(
  weekspan: Weekspan,
  target: EditTarget,
  title: string,
): Weekspan | null {
  const trimmed = title.trim()

  if (target.kind === 'existing') {
    // A blank title on an EXISTING item cancels rather than deleting. Deleting on
    // an accidental select-all-and-backspace would be unrecoverable, and there is
    // an explicit delete elsewhere.
    if (trimmed === '') return null
    return updateTitle(weekspan, target.itemId, trimmed)
  }

  // An abandoned draft leaves nothing behind.
  if (trimmed === '') return null

  try {
    return insertItem(weekspan, {
      title: trimmed,
      ...(target.afterId ? { afterId: target.afterId } : {}),
      ...(target.beforeId ? { beforeId: target.beforeId } : {}),
      ...(target.parentId ? { parentId: target.parentId } : {}),
    }).weekspan
  } catch {
    // insertItem throws on a bad anchor or blank title. Refusing to write is
    // right; letting it escape into a render is not.
    return null
  }
}
