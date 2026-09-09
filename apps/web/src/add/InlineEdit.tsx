import { useEffect, useRef } from 'react'
import './InlineEdit.css'

/**
 * The in-place title editor.
 *
 * Deliberately styled to match `.ws-title-text` exactly. Rows are
 * `display: contents` and cells align across the whole table, so any height
 * difference between the editor and the text it replaces would ripple visibly
 * through the grid the moment you click a title.
 */
export function InlineEdit({
  initial,
  placeholder,
  onCommit,
  onCancel,
  onPasteUrl,
}: {
  initial: string
  placeholder?: string
  onCommit: (title: string) => void
  onCancel: () => void
  /**
   * Offered a paste before the textarea takes it. Return true to say "I turned
   * this into a link chip" and the text is not inserted; false lets the normal
   * paste happen untouched.
   *
   * This exists because clicking a task's text is how you start editing it, so
   * "click the task, paste the link" is the gesture people actually reach for.
   * Without this hook that gesture types a 90-character URL into the title.
   * Only wired for existing item titles — a draft row has no item to attach a
   * link to yet, and notes are prose.
   */
  onPasteUrl?: (data: DataTransfer) => boolean
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const committed = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select all on an existing title so typing replaces it; a caret at the end
    // for a new draft, where there is nothing to replace.
    if (initial) el.select()
    grow(el)
  }, [initial])

  function finish(commit: boolean): void {
    if (committed.current) return
    committed.current = true
    if (commit) onCommit(ref.current?.value ?? '')
    else onCancel()
  }

  return (
    <textarea
      ref={ref}
      className="ws-inline-edit"
      defaultValue={initial}
      placeholder={placeholder ?? 'New item…'}
      rows={1}
      onInput={(e) => grow(e.currentTarget)}
      onPaste={(e) => {
        if (!onPasteUrl || !e.clipboardData) return
        if (onPasteUrl(e.clipboardData)) e.preventDefault()
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        // Enter commits; Shift+Enter is a literal newline, matching quick capture.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
        // Stop grid shortcuts firing while typing — "d" must type a d, not set a
        // due date. resolveKey guards this too; belt and braces at the source.
        e.stopPropagation()
      }}
    />
  )
}

function grow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
