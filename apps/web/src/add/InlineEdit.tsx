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
  onPasteText,
}: {
  initial: string
  placeholder?: string
  onCommit: (title: string) => void
  onCancel: () => void
  /**
   * Offered a paste before the textarea takes it. Return the text to insert
   * instead, or `null` to let the ordinary paste happen untouched.
   *
   * Used to preserve a link's name when the clipboard carried one, by
   * inserting `[name](url)` rather than the bare URL. A bare URL needs no
   * intervention at all — it belongs in the text as-is, and letting the
   * browser paste it keeps this field's native undo working.
   */
  onPasteText?: (data: DataTransfer) => string | null
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
        if (!onPasteText || !e.clipboardData) return
        const text = onPasteText(e.clipboardData)
        if (text === null) return
        e.preventDefault()
        // setRangeText keeps the caret after what was inserted and leaves any
        // selection replaced, matching what a real paste would have done.
        const el = e.currentTarget
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? start
        el.setRangeText(text, start, end, 'end')
        grow(el)
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
