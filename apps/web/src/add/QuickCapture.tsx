import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IsoDate, Project } from '@weekspan/weekspan-core'
import { weekday } from '@weekspan/weekspan-core'
import type { Capture, Token } from './capture.js'
import { parseCapture } from './capture.js'
import { normalizeTitle } from './normalizeTitle.js'
import './QuickCapture.css'

/**
 * The ⌘K overlay (design #3c-C).
 *
 * Presentational only: no store access, no grid knowledge. It parses the
 * typed text into a `Capture` on every keystroke (via `parseCapture`) purely
 * to preview the interpretation — the caller re-derives (or reuses) that same
 * `Capture` when it actually performs the insert, since this component has no
 * way to write anything itself.
 *
 * Text entry is a `<textarea>` (titles run long — the design's own example is
 * 200 characters), so Enter needs to be explicit: plain `⏎` submits with
 * `position: 'top'`, `⌥⏎` with `position: 'backlog'`, `⇧⏎` inserts a literal
 * newline instead of submitting, and `esc` closes without submitting. What
 * "top" and "backlog" resolve to (which afterId/beforeId anchors) is entirely
 * the caller's concern.
 */

const WEEKDAY_ABBR: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function formatDue(due: IsoDate): string {
  const day = WEEKDAY_ABBR[weekday(due)] ?? ''
  const month = MONTH_ABBR[Number(due.slice(5, 7)) - 1] ?? ''
  const dayOfMonth = Number(due.slice(8, 10))
  return `${day} ${dayOfMonth} ${month}`
}

function resolvedLine(capture: Capture, projects: readonly Project[]): string {
  const parts: string[] = []
  if (capture.due !== undefined) parts.push(`due ${formatDue(capture.due)}`)
  if (capture.projectId !== undefined) {
    const project = projects.find((p) => p.id === capture.projectId)
    if (project) parts.push(project.name)
  }
  return parts.join(' · ')
}

/**
 * Render `value` with every `due`/`project` token wrapped in `<mark>`, and
 * everything else — including the exact original whitespace (newlines
 * included) — passed through untouched. This is the underlay that sits
 * beneath the real `<textarea>`; the two must render pixel-identical text,
 * wrapping included, so the highlighting appears to live inside the textarea
 * itself.
 */
function renderHighlighted(value: string, tokens: readonly Token[]): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  const sorted = [...tokens].sort((a, b) => a.start - b.start)

  for (const t of sorted) {
    if (t.kind === 'text') continue
    if (t.start > cursor) nodes.push(value.slice(cursor, t.start))
    nodes.push(
      <mark key={`${t.kind}-${t.start}`} className={`ws-capture-mark ws-capture-mark--${t.kind}`}>
        {value.slice(t.start, t.end)}
      </mark>,
    )
    cursor = t.end
  }
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

export interface QuickCaptureProps {
  /** For resolving a typed project word/prefix and for the resolved-line project name. */
  projects: readonly Project[]
  today: IsoDate
  /** `position` is 'top' on plain `⏎`, 'backlog' on `⌥⏎`. */
  onSubmit: (capture: Capture, position: 'top' | 'backlog') => void
  onClose: () => void
}

/**
 * Grow `el` to fit its content (up to the CSS `max-height` cap, past which
 * the textarea's own `overflow-y: auto` takes over) and keep the highlight
 * underlay's scroll position glued to it. Resetting height to `auto` first
 * is required — otherwise `scrollHeight` would just report the previously
 * set (possibly too-large) height back.
 */
function autoGrow(el: HTMLTextAreaElement, underlay: HTMLDivElement | null): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
  if (underlay) underlay.scrollTop = el.scrollTop
}

export function QuickCapture({ projects, today, onSubmit, onClose }: QuickCaptureProps): JSX.Element {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const underlayRef = useRef<HTMLDivElement>(null)

  const capture = useMemo(() => parseCapture(value, projects, today), [value, projects, today])

  useEffect(() => {
    textareaRef.current?.focus()
    if (textareaRef.current) autoGrow(textareaRef.current, underlayRef.current)
  }, [])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      // ⇧⏎ inserts a literal newline — let the textarea's default behavior
      // handle it rather than submitting.
      if (e.shiftKey) return
      e.preventDefault()
      const title = normalizeTitle(capture.title)
      if (title === '') return
      onSubmit({ ...capture, title }, e.altKey ? 'backlog' : 'top')
    }
  }

  const resolved = resolvedLine(capture, projects)

  return (
    <div
      className="ws-capture-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ws-capture-panel" role="dialog" aria-modal="true" aria-label="Quick capture">
        <div className="ws-capture-input-wrap">
          <div className="ws-capture-underlay" aria-hidden="true" ref={underlayRef}>
            {renderHighlighted(value, capture.tokens)}
          </div>
          <textarea
            ref={textareaRef}
            className="ws-capture-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              autoGrow(e.target, underlayRef.current)
            }}
            onScroll={(e) => {
              if (underlayRef.current) underlayRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            onKeyDown={handleKeyDown}
            placeholder="order tile samples thu weymouth"
            spellCheck={false}
            autoComplete="off"
            rows={1}
            aria-label="Quick capture item"
          />
        </div>
        <div className="ws-capture-resolved">{resolved || ' '}</div>
        <div className="ws-capture-hints">
          <span>
            <kbd>⏎</kbd> add at top
          </span>
          <span>
            <kbd>⇧⏎</kbd> new line
          </span>
          <span>
            <kbd>⌥⏎</kbd> add to backlog
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
