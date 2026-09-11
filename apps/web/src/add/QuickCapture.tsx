import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IsoDate, Link, Project } from '@weekspan/weekspan-core'
import { weekday } from '@weekspan/weekspan-core'
import type { Capture, Token } from './capture.js'
import { parseCapture } from './capture.js'
import type { BulkParse } from './bulkCapture.js'
import { parseBulk } from './bulkCapture.js'
import { normalizeTitle } from './normalizeTitle.js'
import { linkFromClipboard } from '../links/clipboard.js'
import { LinkChip } from '../links/LinkChip.js'
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
 * boolean that the "New project" checkbox and the `⌘⏎`/`Ctrl+⏎` shortcut both
 * read from and write to — deliberately ONE state, not two parallel paths
 * that could drift out of sync: ticking the checkbox makes plain `⏎` create a
 * project too, exactly as `⌘⏎` does. While in project mode, due TOKEN PARSING
 * IS SUPPRESSED (a project named "thu" must not get silently mangled by
 * `parseCapture`) — the whole typed string becomes the project name.
 *
 * **Which project an item joins is an explicit tick, never inferred.** The
 * `ProjectPicker` row lists every project as a checkbox; none ticked (the
 * default) means no project. They are mutually exclusive because an item
 * carries exactly one `projectId` — ticking one unticks the other, so the
 * control can never promise a state the data model cannot hold. This replaced
 * matching typed words against project names, which guessed wrong on ordinary
 * English, ate the matched word out of the title, and gave no way to type a
 * title that merely mentions a project. See `capture.ts` for the full
 * reasoning. The same choice applies to a bulk import, where it lands on
 * every created line.
 *
 * Bulk import mode: when the pasted/typed content has a newline AND more
 * than one non-blank line (the shape a copied spreadsheet range takes —
 * that's the whole reason this exists, migrating an existing todo list),
 * quick-capture switches from previewing ONE item to previewing a BATCH,
 * via `parseBulk` (per-line `parseCapture`, so each line still gets its own
 * due resolution). Plain `⏎` deliberately does NOT submit in this
 * mode — it behaves like `⇧⏎` and inserts a newline instead — because there
 * is no undo in this app, and an accidental paste-and-enter must never be
 * able to write up to ~100 items in one keystroke. Creating requires an
 * explicit button, or `⌘⏎`/`⌘⌥⏎`. Import mode and `projectMode` are
 * mutually exclusive in practice (bulk-creating several projects at once
 * isn't a thing this does), so the "New project" toggle is hidden while
 * import mode is active rather than trying to make the two combine. The
 * project PICKER stays, since a batch lands in a project the same way a
 * single item does.
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

function resolvedLine(capture: Capture, project: Project | undefined): string {
  const parts: string[] = []
  if (capture.due !== undefined) parts.push(`due ${formatDue(capture.due)}`)
  parts.push(project ? project.name : 'no project')
  return parts.join(' · ')
}

/**
 * The opt-in project row.
 *
 * Rendered as checkboxes rather than a `<select>` or radio group because the
 * common case is leaving every one of them alone: "no project" has to be the
 * resting state you reach by doing nothing, and a radio group has no such
 * state once a choice is made. They behave exclusively all the same — clicking
 * a ticked box unticks it, clicking a different one moves the tick — since an
 * item has exactly one `projectId`.
 */
function ProjectPicker({
  projects,
  selected,
  onSelect,
}: {
  projects: readonly Project[]
  selected: string | null
  onSelect: (projectId: string | null) => void
}): JSX.Element | null {
  if (projects.length === 0) return null
  return (
    <div className="ws-capture-projects" role="group" aria-label="Project">
      {projects.map((p) => (
        <label className="ws-capture-project" key={p.id}>
          <input
            type="checkbox"
            checked={selected === p.id}
            onChange={() => onSelect(selected === p.id ? null : p.id)}
          />
          {p.name}
        </label>
      ))}
    </div>
  )
}

/**
 * Render `value` with every `due` token wrapped in `<mark>`, and
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
  /** Offered as opt-in checkboxes. Never matched against the typed text. */
  projects: readonly Project[]
  today: IsoDate
  /**
   * `position` is 'top' on plain `⏎`, 'backlog' on `⌥⏎` (always 'top' for
   * `mode: 'project'` — backlog placement has no meaning for a project).
   * `mode` is 'project' when submitted via `⌘⏎`/`Ctrl+⏎` or with the
   * "New project" checkbox ticked; in that case `capture.title` is the project
   * name (untouched by due-token parsing) and `capture.due` /
   * `capture.projectId` are never set.
   *
   * For an item, `capture.projectId` is whatever the user ticked in the
   * project row — absent when nothing is ticked, which is the default.
   */
  onSubmit: (capture: Capture, position: 'top' | 'backlog', mode: 'item' | 'project') => void
  /**
   * Fired only from bulk-import mode's explicit confirm (button or
   * `⌘⏎`/`⌘⌥⏎`) — never from plain `⏎`. Optional so a caller that hasn't
   * wired up a bulk-commit path yet still typechecks; without it, the
   * confirm controls render but do nothing when activated.
   */
  onSubmitBulk?: (
    parse: BulkParse,
    position: 'top' | 'backlog',
    projectId: string | null,
  ) => void
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
  // The ticked project, or null for none. Null is the default and the only
  // resting state — nothing typed can move it.
  const [projectId, setProjectId] = useState<string | null>(null)
  /**
   * Links pasted into the box. Pasting ONE bare URL (see `urlFromPaste`) keeps
   * it out of the text and shows it here as a chip instead, so "type the todo,
   * paste the doc, Enter" creates the item with the doc attached rather than
   * with a 90-character URL in its title. That gesture was the one people
   * reached for and the one that did nothing.
   */
  const [links, setLinks] = useState<Link[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const underlayRef = useRef<HTMLDivElement>(null)

  // Parsed unconditionally (cheap, and needed for item-mode submits), but its
  // due tokens are deliberately ignored below whenever `projectMode` or
  // `importMode` is on — see the module doc.
  const capture = useMemo(() => parseCapture(value, today), [value, today])

  // A project deleted out from under an open overlay must not stay ticked and
  // then be written to the new item. Falling back to null keeps the invariant
  // that the tick always names a project that exists.
  const selectedProject = projects.find((p) => p.id === projectId)
  const effectiveProjectId = selectedProject ? projectId : null

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
    () => (importMode ? parseBulk(value, today) : null),
    [importMode, value, today],
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
        onSubmitBulk?.(bulkParse, e.altKey ? 'backlog' : 'top', effectiveProjectId)
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

      // A capture that is ONLY a pasted link is still a todo — name it after
      // the link rather than refusing Enter with nothing to show for it.
      const title = normalizeTitle(capture.title) || (links[0]?.title ?? '')
      if (title === '') return
      onSubmit(
        {
          ...capture,
          title,
          ...(links.length > 0 ? { links } : {}),
          // exactOptionalPropertyTypes: "no project" is an ABSENT key, not
          // `projectId: undefined`.
          ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
        },
        e.altKey ? 'backlog' : 'top',
        'item',
      )
    }
  }

  const resolved = projectMode
    ? (() => {
        const name = normalizeTitle(value)
        return name === '' ? '' : `new project · ${name}`
      })()
    : resolvedLine(capture, selectedProject)

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
            onPaste={(e) => {
              // A project has no links, and a bulk paste is many lines — both
              // keep the browser's ordinary paste.
              if (projectMode || importMode) return
              const link = linkFromClipboard(e.clipboardData)
              if (!link) return
              e.preventDefault()
              setLinks((cur) => (cur.some((l) => l.url === link.url) ? cur : [...cur, link]))
            }}
            placeholder="order tile samples thu"
            spellCheck={false}
            autoComplete="off"
            rows={1}
            aria-label="Quick capture item"
          />
        </div>
        {/*
          * The picker comes FIRST and the mode switch last, behind a rule. Sat
          * side by side and identically styled, "New project" read as a fourth
          * project you could file this item under — the opposite of what it
          * does. Order and a separator carry that distinction without adding a
          * label to a row that has to stay one line.
          */}
        {links.length > 0 && !projectMode && !importMode ? (
          <div className="ws-capture-links ws-links">
            {links.map((l) => (
              <LinkChip
                key={l.url}
                link={l}
                editing={false}
                onRemove={() => setLinks((cur) => cur.filter((x) => x.url !== l.url))}
              />
            ))}
          </div>
        ) : null}
        <div className="ws-capture-controls">
          {/* Naming the project being CREATED, so there is nothing to file it under. */}
          {projectMode ? null : (
            <ProjectPicker
              projects={projects}
              selected={effectiveProjectId}
              onSelect={setProjectId}
            />
          )}
          {importMode ? null : (
            <label className="ws-capture-project-toggle">
              <input
                type="checkbox"
                checked={projectMode}
                onChange={(e) => setProjectMode(e.target.checked)}
              />
              New project
            </label>
          )}
        </div>
        {importMode && bulkParse ? (
          <BulkPreview parse={bulkParse} />
        ) : (
          <div className="ws-capture-resolved">{resolved || ' '}</div>
        )}
        {importMode && bulkParse ? (
          <div className="ws-capture-bulk-actions">
            <button
              type="button"
              className="ws-capture-bulk-btn ws-capture-bulk-btn--ghost"
              disabled={bulkParse.createCount === 0}
              onClick={() => onSubmitBulk?.(bulkParse, 'backlog', effectiveProjectId)}
            >
              Add to backlog
            </button>
            <button
              type="button"
              className="ws-capture-bulk-btn ws-capture-bulk-btn--primary"
              disabled={bulkParse.createCount === 0}
              onClick={() => onSubmitBulk?.(bulkParse, 'top', effectiveProjectId)}
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
                <kbd>⌘⏎</kbd> new project
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
 *
 * No per-line project is shown: the batch's project is one choice made in the
 * picker above, identical on every line, so repeating it N times would be
 * noise rather than information.
 */
function BulkPreview({ parse }: { parse: BulkParse }): JSX.Element {
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
              {line.reason ? <span className="ws-capture-bulk-reason">{line.reason}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
