import { removeItem, type Weekspan } from '@weekspan/weekspan-core'
import { insertItem, updateTitle } from './draft.js'

/**
 * Editing an existing title and typing a brand-new item are the SAME
 * interaction — you click into the list and type. One commit path, two entry
 * points, so they cannot drift apart in feel or in behaviour.
 */

export type EditTarget =
  | { kind: 'existing'; itemId: string }
  | {
      kind: 'new'
      afterId: string | null
      beforeId: string | null
      parentId: string | null
      /**
       * Group to create into, set only by a Project-view seam. Absent means
       * "no opinion" — Priority view has no groups, so a new item there is
       * unassigned, exactly as before. `null` is a real value (the unassigned
       * bucket) and is distinct from absent.
       */
      projectId?: string | null
    }

/**
 * Returns the next weekspan, or null for any no-op — matching the `mutate`
 * contract, so an unchanged title or an abandoned draft writes nothing at all.
 */
export function commitEdit(
  weekspan: Weekspan,
  target: EditTarget,
  title: string,
  /**
   * Called instead of writing when the insert is refused. Optional only so the
   * pure tests can ignore it — every real caller passes one, because a refusal
   * the user cannot see is indistinguishable from a broken app.
   */
  onRefused?: (reason: string) => void,
): Weekspan | null {
  const trimmed = title.trim()

  if (target.kind === 'existing') {
    // Blanking a title DELETES the item — an item with no title is not a thing
    // the grid can render or the user can act on, so leaving it behind as an
    // invisible row was worse than removing it. Children go with it (see
    // `removeItem`: an orphaned parentId makes the file unparseable).
    //
    // This is destructive and there is no undo, so the caller is expected to say
    // what went — see App's onCommitEdit, which names the deleted item.
    if (trimmed === '') return removeItem(weekspan, target.itemId)
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
      ...(target.projectId != null ? { projectId: target.projectId } : {}),
    }).weekspan
  } catch (err) {
    // insertItem throws on a bad anchor. Refusing to write is right, and
    // letting the throw escape into a render is not — but swallowing it whole
    // was worse than either: a file with two items sharing a rank presented as
    // "Enter does nothing", with no message and nothing in the console.
    onRefused?.(err instanceof Error ? err.message : String(err))
    return null
  }
}
