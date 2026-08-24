import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IsoDate, Project } from '@weekspan/weekspan-core'
import { weekday } from '@weekspan/weekspan-core'
import type { Capture, Token } from './capture.js'
import { parseCapture } from './capture.js'
import type { BulkParse } from './bulkCapture.js'
import { parseBulk } from './bulkCapture.js'
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
 *
 * There's also a project-creation mode, toggled by a single `projectMode`
 * boolean that the "Project" checkbox and the `⌘⏎`/`Ctrl+⏎` shortcut both
 * read from and write to — deliberately ONE state, not two parallel paths
 * that could drift out of sync: ticking the checkbox makes plain `⏎` create a
 * project too, exactly as `⌘⏎` does. While in project mode, due/project TOKEN
 * PARSING IS SUPPRESSED (a project named "thu", or one whose name happens to
 * collide with an existing project, must not get silently mangled by
 * `parseCapture`) — the whole typed string becomes the project name.
 *
 * Bulk import mode: when the pasted/typed content has a newline AND more
 * than one non-blank line (the shape a copied spreadsheet range takes —
 * that's the whole reason this exists, migrating an existing todo list),
 * quick-capture switches from previewing ONE item to previewing a BATCH,
 * via `parseBulk` (per-line `parseCapture`, so each line still gets its own
 * due/project resolution). Plain `⏎` deliberately does NOT submit in this
 * mode — it behaves like `⇧⏎` and inserts a newline instead — because there
 * is no undo in this app, and an accidental paste-and-enter must never be
 * able to write up to ~100 items in one keystroke. Creating requires an
 * explicit button, or `⌘⏎`/`⌘⌥⏎`. Import mode and `projectMode` are
 * mutually exclusive in practice (bulk-creating several projects at once
 * isn't a thing this does), so the project toggle is hidden while import
 * mode is active rather than trying to make the two combine.
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
  /**
   * `position` is 'top' on plain `⏎`, 'backlog' on `⌥⏎` (always 'top' for
   * `mode: 'project'` — backlog placement has no meaning for a project).
   * `mode` is 'project' when submitted via `⌘⏎`/`Ctrl+⏎` or with the
   * "Project" checkbox ticked; in that case `capture.title` is the project
   * name (untouched by due/project token parsing) and `capture.due` /
   * `capture.projectId` are never set.
   */
  onSubmit: (capture: Capture, position: 'top' | 'backlog', mode: 'item' | 'project') => void
  /**
   * Fired only from bulk-import mode's explicit confirm (button or
   * `⌘⏎`/`⌘⌥⏎`) — never from plain `⏎`. Optional so a caller that hasn't
   * wired up a bulk-commit path yet still typechecks; without it, the
   * confirm controls render but do nothing when activated.
   */
  onSubmitBulk?: (parse: BulkParse, position: 'top' | 'backlog') => void
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

export function QuickCapture({
  projects,
  today,
  onSubmit,
  onSubmitBulk,
  onClose,
}: QuickCaptureProps): JSX.Element {
  const [value, setValue] = useState('')
  // Single source of truth for project-creation mode. Both the "Project"
  // checkbox and the `⌘⏎`/`Ctrl+⏎` shortcut read/write this ONE flag — never
  // two independently-tracked "is this a project" checks that could disagree.
  const [projectMode, setProjectMode] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const underlayRef = useRef<HTMLDivElement>(null)

  // Parsed unconditionally (cheap, and needed for item-mode submits), but its
  // due/project tokens are deliberately ignored below whenever `projectMode`
  // or `importMode` is on — see the module doc.
  const capture = useMemo(() => parseCapture(value, projects, today), [value, projects, today])

  // Bulk import mode: a newline AND more than one non-blank line. A pasted
  // single title that merely happens to contain a blank line (or a trailing
  // newline left over from copying one cell) must still behave as ONE item,
  // exactly as it always has — so this is deliberately "more than one
  // non-blank line", not just "contains a newline".
  const importMode = useMemo(() => {
    if (!value.includes('\n')) return false
    const nonBlank = value.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').length
    return nonBlank > 1
  }, [value])

  const bulkParse = useMemo<BulkParse | null>(
    () => (importMode ? parseBulk(value, projects, today) : null),
    [importMode, value, projects, today],
  )

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

      if (importMode) {
        // Plain ⏎ must NOT submit here — there is no undo, and an accidental
        // paste-and-enter must never write up to ~100 items. Only the
        // explicit ⌘⏎ (top) / ⌘⌥⏎ (backlog) shortcuts confirm; plain ⏎ falls
        // through exactly like ⇧⏎ and inserts a newline instead.
        if (!(e.metaKey || e.ctrlKey)) return
        e.preventDefault()
        if (!bulkParse || bulkParse.createCount === 0) return
        onSubmitBulk?.(bulkParse, e.altKey ? 'backlog' : 'top')
        return
      }

      e.preventDefault()

      // ⌘⏎/Ctrl+⏎ folds into the same `projectMode` flag the checkbox uses —
      // pressing it while the box is unticked is equivalent to ticking it
      // and then pressing plain ⏎.
      const asProject = projectMode || e.metaKey || e.ctrlKey
      if (asProject && !projectMode) setProjectMode(true)

      if (asProject) {
        const title = normalizeTitle(value)
        if (title === '') return
        onSubmit({ title, tokens: [] }, 'top', 'project')
        return
      }

      const title = normalizeTitle(capture.title)
      if (title === '') return
      onSubmit({ ...capture, title }, e.altKey ? 'backlog' : 'top', 'item')
    }
  }

  const resolved = projectMode
    ? (() => {
        const name = normalizeTitle(value)
        return name === '' ? '' : `new project · ${name}`
      })()
    : resolvedLine(capture, projects)

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
            {renderHighlighted(value, projectMode || importMode ? [] : capture.tokens)}
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
        {importMode ? null : (
          <label className="ws-capture-project-toggle">
            <input
              type="checkbox"
              checked={projectMode}
              onChange={(e) => setProjectMode(e.target.checked)}
            />
            Project
          </label>
        )}
        {importMode && bulkParse ? (
          <BulkPreview parse={bulkParse} projects={projects} />
        ) : (
          <div className="ws-capture-resolved">{resolved || ' '}</div>
        )}
        {importMode && bulkParse ? (
          <div className="ws-capture-bulk-actions">
            <button
              type="button"
              className="ws-capture-bulk-btn ws-capture-bulk-btn--ghost"
              disabled={bulkParse.createCount === 0}
              onClick={() => onSubmitBulk?.(bulkParse, 'backlog')}
            >
              Add to backlog
            </button>
            <button
              type="button"
              className="ws-capture-bulk-btn ws-capture-bulk-btn--primary"
              disabled={bulkParse.createCount === 0}
              onClick={() => onSubmitBulk?.(bulkParse, 'top')}
            >
              Create {bulkParse.createCount} item{bulkParse.createCount === 1 ? '' : 's'}
            </button>
          </div>
        ) : null}
        <div className="ws-capture-hints">
          {importMode ? (
            <>
              <span>
                <kbd>⏎</kbd> new line
              </span>
              <span>
                <kbd>⌘⏎</kbd> create at top
              </span>
              <span>
                <kbd>⌘⌥⏎</kbd> add to backlog
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
            </>
          ) : projectMode ? (
            <>
              <span>
                <kbd>⏎</kbd> create project
              </span>
              <span>
                <kbd>⇧⏎</kbd> new line
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
            </>
          ) : (
            <>
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
                <kbd>⌘⏎</kbd> create project
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The import-mode preview: a count plus a scrollable, height-bounded list of
 * every parsed line (the `max-height` cap lives in `QuickCapture.css` — a
 * 100+ line paste must preview inline, never blow the overlay past the
 * viewport). Skipped lines and possible-duplicate/extra-column warnings get
 * a visibly distinct treatment so a scan of the list tells you what's about
 * to happen before you commit to it.
 */
function BulkPreview({ parse, projects }: { parse: BulkParse; projects: readonly Project[] }): JSX.Element {
  const skippedCount = parse.lines.length - parse.createCount
  return (
    <div className="ws-capture-bulk">
      <div className="ws-capture-bulk-header">
        Create {parse.createCount} item{parse.createCount === 1 ? '' : 's'}
        {skippedCount > 0 ? (
          <span className="ws-capture-bulk-skipped-count"> · {skippedCount} skipped</span>
        ) : null}
      </div>
      <div className="ws-capture-bulk-list" role="list">
        {parse.lines.map((line, i) => {
          const project = line.projectId ? projects.find((p) => p.id === line.projectId) : undefined
          return (
            <div
              key={i}
              role="listitem"
              className={
                'ws-capture-bulk-line' +
                (line.skipped
                  ? ' ws-capture-bulk-line--skipped'
                  : line.reason
                    ? ' ws-capture-bulk-line--warn'
                    : '')
              }
            >
              <span className="ws-capture-bulk-title">
                {line.skipped ? line.raw.trim() || '(blank line)' : line.title}
              </span>
              {!line.skipped && line.due ? (
                <span className="ws-capture-bulk-meta ws-capture-bulk-meta--due">{formatDue(line.due)}</span>
              ) : null}
              {!line.skipped && project ? (
                <span className="ws-capture-bulk-meta ws-capture-bulk-meta--project">{project.name}</span>
              ) : null}
              {line.reason ? <span className="ws-capture-bulk-reason">{line.reason}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
