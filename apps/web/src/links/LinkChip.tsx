import { useEffect, useRef } from 'react'
import type { Link } from '@weekspan/weekspan-core'
import './LinkChip.css'

/**
 * A link chip: kind icon, title, remove.
 *
 * Three actions in a chip 16px tall, and no room for a menu, so each one is
 * attached to the part of the chip it obviously belongs to:
 *
 *   - **the icon opens the link.** It is the only part of the chip that
 *     depicts the document rather than describing it.
 *   - **the title renames.** Click-text-to-edit is this app's idiom
 *     everywhere else — item titles, notes, project group names — so the chip
 *     inherits it rather than inventing a fourth convention. It also has to be
 *     the easy action: the clipboard supplies a real title only when you
 *     copied from inside a document, so anything copied from the address bar
 *     lands as "Google Doc" and needs renaming.
 *   - **× removes**, revealed on hover so it is not four pixels from the
 *     rename target at rest.
 *
 * The usual web convention (click the text, follow the link) is deliberately
 * not used. Following a link is the rarer action here — the chip exists so a
 * row can say what it is attached to at a glance — and clicking text to open a
 * new tab would collide with every other click-to-edit surface in the grid.
 */
export function LinkChip({
  link,
  editing,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRemove,
}: {
  link: Link
  editing: boolean
  onStartRename?: () => void
  onCommitRename?: (title: string) => void
  onCancelRename?: () => void
  onRemove?: () => void
}): JSX.Element {
  return (
    <span className={`ws-link ws-link--${link.kind ?? 'generic'}`}>
      <a
        className="ws-link-icon"
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open ${link.title}`}
        aria-label={`Open ${link.title}`}
      >
        {GLYPH[link.kind ?? ''] ?? '·'}
      </a>
      {editing ? (
        <LinkTitleEdit
          initial={link.title}
          onCommit={(t) => onCommitRename?.(t)}
          onCancel={() => onCancelRename?.()}
        />
      ) : (
        <>
          <span
            className="ws-link-title"
            {...(onStartRename ? { title: 'Click to rename', onClick: onStartRename } : {})}
          >
            {link.title}
          </span>
          {onRemove ? (
            <button
              type="button"
              className="ws-link-remove"
              title="Remove link"
              aria-label={`Remove ${link.title}`}
              onClick={onRemove}
            >
              ×
            </button>
          ) : null}
        </>
      )}
    </span>
  )
}

/**
 * One letter per Google product, rather than an image or an icon font — the
 * design's own rule is that every mark in the grid is text or CSS, and at
 * 12px a letter on the product's colour is more legible than a shrunken logo
 * would be anyway. The colour is what you actually recognise.
 */
const GLYPH: Record<string, string> = {
  gdoc: 'D',
  gsheet: 'S',
  gslides: 'P',
  gform: 'F',
  gdrive: '▲',
}

/**
 * The chip's rename field. A bare `<input>`, not `InlineEdit` — that is a
 * growing textarea sized to match `.ws-title-text`, which inside a 16px chip
 * would blow the row height open on every rename.
 */
function LinkTitleEdit({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (title: string) => void
  onCancel: () => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const committed = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function finish(commit: boolean): void {
    if (committed.current) return
    committed.current = true
    if (commit) onCommit(ref.current?.value ?? '')
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className="ws-link-edit"
      defaultValue={initial}
      size={Math.max(initial.length, 8)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
        // Grid shortcuts must not fire while typing a title — "d" is a letter
        // here, not a due date. Mirrors InlineEdit.
        e.stopPropagation()
      }}
    />
  )
}
