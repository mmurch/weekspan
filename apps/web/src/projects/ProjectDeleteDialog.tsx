import { useEffect, useRef } from 'react'
import type { Item, RemoveProjectMode } from '@weekspan/weekspan-core'
import './ProjectDeleteDialog.css'

/**
 * Confirmation for deleting a project group.
 *
 * The whole reason this exists is that "delete this project" is genuinely
 * ambiguous, and the two readings do opposite things to the user's data:
 *
 *   - retire the CATEGORY, keep the work (the common case — a project is a
 *     long-lived label, and dropping the label rarely means the tasks stopped
 *     mattering);
 *   - clear out the whole batch, work included (real, but rare).
 *
 * So this asks rather than picking, and the non-destructive option is the one
 * presented first and styled as the default. Guessing wrong in the destructive
 * direction is unrecoverable — there is no undo and no server-side history.
 *
 * Presentational only: every action is a callback, and it never touches the
 * store. Counts are computed by the caller from `projectDeletionImpact`.
 */

export interface ProjectDeleteDialogProps {
  projectName: string
  /** Items actually carrying this project's id. */
  directItems: Item[]
  /**
   * Sub-items that would be swept up under `deleteItems` because their parent
   * is in this project — even though they are not themselves in it.
   * Surfaced separately because a confirmation that undercounts is worse than
   * one that looks fussy.
   */
  orphanedChildren: Item[]
  onConfirm: (mode: RemoveProjectMode) => void
  onDismiss: () => void
}

export function ProjectDeleteDialog({
  projectName,
  directItems,
  orphanedChildren,
  onConfirm,
  onDismiss,
}: ProjectDeleteDialogProps): JSX.Element {
  const keepRef = useRef<HTMLButtonElement>(null)

  // Focus the SAFE option, so a stray Enter keeps the work rather than deleting it.
  useEffect(() => {
    keepRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onDismiss])

  const total = directItems.length + orphanedChildren.length
  const empty = total === 0

  return (
    <div className="ws-projdel-backdrop" onPointerDown={onDismiss}>
      <div
        className="ws-projdel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-projdel-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="ws-projdel-title" id="ws-projdel-title">
          Delete project <span className="ws-projdel-name">{projectName}</span>?
        </h2>

        {empty ? (
          <p className="ws-projdel-lede">Nothing is in it, so nothing else changes.</p>
        ) : (
          <p className="ws-projdel-lede">
            {directItems.length === 1 ? '1 item is' : `${directItems.length} items are`} in it
            {orphanedChildren.length > 0
              ? `, with ${orphanedChildren.length === 1 ? '1 sub-item' : `${orphanedChildren.length} sub-items`} under them`
              : ''}
            .
          </p>
        )}

        <div className="ws-projdel-actions">
          <button
            ref={keepRef}
            className="ws-projdel-btn ws-projdel-btn--primary"
            type="button"
            onClick={() => onConfirm('unassign')}
          >
            {empty ? 'Delete project' : 'Keep the items'}
          </button>
          {empty ? null : (
            <button
              className="ws-projdel-btn ws-projdel-btn--danger"
              type="button"
              onClick={() => onConfirm('deleteItems')}
            >
              Delete the items too
            </button>
          )}
          <button className="ws-projdel-btn" type="button" onClick={onDismiss}>
            Cancel
          </button>
        </div>

        {empty ? null : (
          <p className="ws-projdel-note">
            Keeping them leaves every item exactly where it is, just with no project.
            {orphanedChildren.length > 0
              ? ' Deleting takes the sub-items too — a sub-item cannot outlive its parent.'
              : ' Deleting cannot be undone.'}
          </p>
        )}
      </div>
    </div>
  )
}
