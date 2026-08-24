import { useEffect } from 'react'
import './Notice.css'

/**
 * A transient notice.
 *
 * Exists because several actions change more than the thing you touched, and
 * doing that silently is alarming when you notice later:
 *   - marking a day vacation reschedules every due on it
 *   - a merge resolves a conflict toward this session, discarding another device's edit
 *   - close-out archives items out of the working file
 *
 * Deliberately not a modal. These are reports of something already done, not
 * questions — interrupting the grid to say "3 items moved" would be worse than
 * the silence it replaces.
 */
export interface NoticeMessage {
  id: number
  text: string
  /** `warn` reports something the user may want to undo by hand; there is no undo. */
  tone: 'info' | 'warn'
}

export function Notice({
  message,
  onDismiss,
  autoDismissMs = 6000,
}: {
  message: NoticeMessage | null
  onDismiss: () => void
  autoDismissMs?: number
}): JSX.Element | null {
  useEffect(() => {
    if (!message || autoDismissMs <= 0) return
    // Warnings stay until dismissed: a discarded edit is worth reading properly,
    // and a timer that removes it before the user looks up defeats the point.
    if (message.tone === 'warn') return
    const id = setTimeout(onDismiss, autoDismissMs)
    return () => clearTimeout(id)
  }, [message, autoDismissMs, onDismiss])

  if (!message) return null

  return (
    <div className={`ws-notice ws-notice--${message.tone}`} role="status" aria-live="polite">
      <span className="ws-notice-text">{message.text}</span>
      <button className="ws-notice-close" type="button" onClick={onDismiss} title="Dismiss">
        ×
      </button>
    </div>
  )
}
