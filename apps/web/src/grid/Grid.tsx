import type { CellVM, DayColumn, GridVM, RowVM, WeekBlock } from './viewModel.js'
import { Fragment } from 'react'
import type React from 'react'
import type { IsoDate } from '@weekspan/weekspan-core'
import { intentForMouse, type MouseIntent } from '../interaction/mouse.js'
import { isItemSelected } from '../interaction/selection.js'
import { InlineEdit } from '../add/InlineEdit.js'
import type { ProjectRow } from './projectView.js'
import { dividerKey } from '../interaction/projectDragPreview.js'

export interface GridInteraction {
  /** Currently selected cell, or null. */
  /** `date: null` selects the ITEM column — the frozen title cell. */
  selection?: { itemId: string; date: IsoDate | null } | null
  /**
   * One callback for every mouse path. Left = select, right = cycle,
   * left-double = menu, middle = nothing; `intentForMouse` decides which.
   */
  onCellMouse?: (
    itemId: string,
    date: IsoDate,
    intent: MouseIntent,
    x: number,
    y: number,
  ) => void
  /** Fired by the week close affordance. */
  onCloseOut?: (week: string) => void
  /** Pointer handlers for the drag grip, from `useDragPreview`. */
  gripHandlers?: (itemId: string) => { onPointerDown: (e: React.PointerEvent) => void }
  /**
   * Rows in prospective order while a drag is in progress. When set, these are
   * rendered instead of `vm.rows` — so the row visibly occupies its new position
   * as the pointer moves, rather than a separate line hinting at it.
   */
  previewRows?: RowVM[] | null
  /** Id of the row being dragged, for the lifted styling. */
  draggingId?: string | null
  /** Id of the row whose title is being edited in place, if any. */
  editingId?: string | null
  onStartEdit?: (itemId: string) => void
  onCommitEdit?: (title: string) => void
  onCancelEdit?: () => void
  /**
   * A draft row sits in the gap identified by these neighbours. Rendered as an
   * ordinary row so typing a new item feels exactly like editing an existing one.
   */
  /**
   * Which seam currently holds the unsaved draft row, as a slot key:
   * `top`, `after:<itemId>`, or `group:<dividerKey>`. A bare item id could not
   * name the two slots that have no row above them — the top of Priority view
   * and the first position in a project group — so both were unreachable: the
   * seam opened a draft that then rendered nowhere.
   */
  draftSlot?: string | null
  /** Delete a project group. Never offered for the unassigned bucket. */
  onDeleteProject?: (projectId: string) => void
  /** Project whose name is currently being edited in its group header. */
  editingProjectId?: string | null
  /** Click the group name to rename. Never offered for the unassigned bucket. */
  onStartRenameProject?: (projectId: string) => void
  /** Commit a rename. The caller reports a blank or duplicate name; this never validates. */
  onCommitRenameProject?: (name: string) => void
  onCancelRenameProject?: () => void
  /** Clicking the add-item row at the foot of the list. Same path as pressing N. */
  onAddItem?: () => void
  /** The sort-by-date button in the ITEM header. Omit it and no button renders. */
  onSortByDate?: () => void
  /** Clicking the seam between two rows opens a draft there. */
  onInsertBetween?: (
    afterId: string | null,
    beforeId: string | null,
    parentId: string | null,
    /** Project-view seams only: the group the new item should join. */
    projectId?: string | null,
  ) => void
  /**
   * Project view: rows interleaved with group dividers. When set, these replace
   * the flat row list. Same grid, same geometry — only the row sequence differs.
   */
  projectRows?: ProjectRow[] | null
  onToggleGroup?: (projectId: string | null) => void
  /**
   * Open the colour picker for a group. `null` is the unassigned bucket, which
   * can be coloured too — its colour is a per-device preference rather than a
   * field in the ledger (see `projects/noProjectColor.ts`).
   */
  onPickColor?: (projectId: string | null, x: number, y: number) => void
  /** Clicking a date header toggles vacation for that day. */
  onToggleVacation?: (date: IsoDate) => void
  /** Notes editing, mirroring title editing. */
  editingNotesId?: string | null
  onStartEditNotes?: (itemId: string) => void
  onCommitNotes?: (notes: string) => void
}
import './Grid.css'

/**
 * Renders a GridVM.
 *
 * Deliberately dumb: no domain logic, no date maths, no derivation. Everything it
 * draws was decided by `buildGrid`, which in turn delegates to weekspan-core. If a
 * rule needs to change, it changes there — not here.
 */

const ITEM_COLUMN = { grip: 24, bar: 3, title: 333 }
const DAY = 38
const WEEKEND_DAY = 19

/**
 * The column template is what makes alignment structural. Header cells span
 * columns of the SAME grid the body rows use, so a week label and the five day
 * columns beneath it cannot drift apart.
 */
function columnTemplate(weekCount: number): string {
  const week = `repeat(5, ${DAY}px) repeat(2, ${WEEKEND_DAY}px)`
  return `${ITEM_COLUMN.grip}px ${ITEM_COLUMN.bar}px ${ITEM_COLUMN.title}px ${`${week} `.repeat(weekCount).trim()}`
}

function DayHeader({
  day,
  isPast,
  onToggleVacation,
}: {
  day: DayColumn
  isPast: boolean
  onToggleVacation?: (date: IsoDate) => void
}): JSX.Element {
  const cls = [
    'ws-day',
    day.isWeekend ? 'ws-day--weekend' : '',
    isPast ? 'ws-day--past' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (day.isToday) {
    return (
      <div className={cls} onClick={() => onToggleVacation?.(day.date)} title="Toggle vacation">
        <span className="ws-day-disc">
          <span>{day.letter}</span>
          <span>{day.dayOfMonth}</span>
        </span>
      </div>
    )
  }
  if (day.isVacation) {
    return (
      <div className={cls} onClick={() => onToggleVacation?.(day.date)} title="Toggle vacation">
        <span className="ws-day-disc ws-day-disc--vacation">
          <span>{day.letter}</span>
          <span>{day.dayOfMonth}</span>
        </span>
      </div>
    )
  }
  return (
    <div className={cls} onClick={() => onToggleVacation?.(day.date)} title="Toggle vacation">
      <span className="ws-day-letter">{day.letter}</span>
      <span className="ws-day-num">{day.dayOfMonth}</span>
    </div>
  )
}

function WeekHeader({
  week,
  onCloseOut,
}: {
  week: WeekBlock
  onCloseOut?: (week: string) => void
}): JSX.Element {
  return (
    <>
      <div className={`ws-head-weeklabel${week.isPast ? ' ws-head-weeklabel--past' : ''}`}>
        <span className="ws-week-id">{week.label}</span>
        <span className="ws-week-range">{week.range}</span>
        {/* Present only on a closeable past week — inert and absent otherwise. */}
        {week.showClose ? (
          <button
            className={`ws-week-close${week.closeable ? '' : ' ws-week-close--blocked'}`}
            type="button"
            title={
              week.closeable
                ? `Close out ${week.label}`
                : `${week.label} cannot close yet — see what is blocking it`
            }
            onClick={() => onCloseOut?.(week.week)}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="ws-head-weekendspacer" />
    </>
  )
}

function Chip({ cell }: { cell: CellVM }): JSX.Element | null {
  if (cell.kind === null) return null
  const generated = cell.generated ? ' ws-chip--generated' : ''
  if (cell.kind === 'done') return <div className={`ws-chip ws-chip--done${generated}`}>✓</div>
  if (cell.kind === 'due') return <div className={`ws-chip ws-chip--due${generated}`}>DUE</div>
  return <div className={`ws-chip ws-chip--skip${generated}`}>SKIP</div>
}

function Cell({
  cell,
  itemId,
  selected,
  onCellMouse,
}: {
  cell: CellVM
  itemId: string
  selected: boolean
  onCellMouse?: (
    itemId: string,
    date: IsoDate,
    intent: MouseIntent,
    x: number,
    y: number,
  ) => void
}): JSX.Element {
  const cls = [
    'ws-cell',
    cell.isWeekend ? 'ws-cell--weekend' : '',
    cell.isPastWeek ? 'ws-cell--past' : '',
    cell.isToday ? 'ws-cell--today' : '',
    cell.isVacation ? 'ws-cell--vacation' : '',
    selected ? 'ws-cell--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // data-cell-date is what the screenshot harness measures to prove that every
  // cell sharing a date also shares an x-position, even across wrapping rows.
  return (
    /*
     * Three separate events, deliberately: native `click` only ever fires for the
     * LEFT button. Right click fires `contextmenu` and never `click`; middle
     * click fires `auxclick` and never `click`. One handler cannot cover them.
     *
     * The `mousedown` preventDefault is specifically for middle click — Chrome
     * arms its autoscroll widget at mousedown, so suppressing it at click time is
     * already too late.
     */
    <div
      className={cls}
      data-cell-date={cell.date}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onClick={(e) => {
        const intent = intentForMouse(e.button, e.detail)
        if (intent) onCellMouse?.(itemId, cell.date, intent, e.clientX, e.clientY)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        const intent = intentForMouse(2, e.detail)
        if (intent) onCellMouse?.(itemId, cell.date, intent, e.clientX, e.clientY)
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        const intent = intentForMouse(1, e.detail)
        if (intent) onCellMouse?.(itemId, cell.date, intent, e.clientX, e.clientY)
      }}
    >
      <Chip cell={cell} />
    </div>
  )
}

function Row({
  row,
  interaction,
  dragging,
}: {
  row: RowVM
  interaction: GridInteraction
  dragging: boolean
}): JSX.Element {
  const titleCls = [
    'ws-title',
    row.state === 'finished' ? 'ws-title--finished' : '',
    row.depth === 1 ? 'ws-title--child' : '',
    isItemSelected(interaction.selection ?? null, row.id) ? 'ws-title--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const textCls = [
    'ws-title-text',
    row.style.strikethrough ? 'ws-title-text--finished' : '',
    row.style.italic ? 'ws-title-text--skipped' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const barStyle = row.projectColorToken
    ? { ['--ws-bar-color' as string]: `var(--ws-${kebab(row.projectColorToken)})` }
    : undefined

  return (
    <div className={`ws-row${dragging ? ' ws-row--dragging' : ''}`} data-row-id={row.id}>
      <div
        className="ws-grip"
        {...(interaction.gripHandlers ? interaction.gripHandlers(row.id) : {})}
      >
        ⠿⠿
      </div>
      <div className="ws-bar" style={barStyle} />
      <div className={titleCls}>
        {row.depth === 1 ? <span className="ws-elbow" /> : null}
        {interaction.editingId === row.id ? (
          <InlineEdit
            initial={row.title}
            onCommit={(t) => interaction.onCommitEdit?.(t)}
            onCancel={() => interaction.onCancelEdit?.()}
          />
        ) : (
          <span
            className={textCls}
            onClick={() => interaction.onStartEdit?.(row.id)}
            title="Click to edit"
          >
            {row.title}
          </span>
        )}
        {interaction.editingNotesId === row.id ? (
          <InlineEdit
            initial={row.notes ?? ''}
            placeholder="Notes — one per line"
            onCommit={(t) => interaction.onCommitNotes?.(t)}
            onCancel={() => interaction.onCancelEdit?.()}
          />
        ) : row.notes ? (
          <span className="ws-notes" onClick={() => interaction.onStartEditNotes?.(row.id)}>
            {row.notes
              .split('\n')
              .map((line) => line.replace(/^\s*[-*]\s*/, ''))
              .filter(Boolean)
              .map((line, i) => (
                <span key={i}>
                  <span className="ws-note-bullet">·</span>
                  {line}
                </span>
              ))}
          </span>
        ) : null}
        {row.links.length > 0 ? (
          <span className="ws-links">
            {row.links.map((link) => (
              <span className="ws-link" key={link.url}>
                <span className="ws-link-dot" />
                {link.title}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {row.cells.map((cell) => (
        <Cell
          cell={cell}
          itemId={row.id}
          selected={
            interaction.selection?.itemId === row.id && interaction.selection?.date === cell.date
          }
          {...(interaction.onCellMouse ? { onCellMouse: interaction.onCellMouse } : {})}
          key={cell.date}
        />
      ))}
    </div>
  )
}

/**
 * Which sibling scope the gap AFTER row `i` belongs to.
 *
 * A gap between two children belongs to their parent; a gap between roots, or
 * after the last child of a group, belongs to the root scope. Getting this wrong
 * puts a new item in an arbitrary position, because ranks only compare within a
 * scope.
 */
function seamParentId(rows: readonly RowVM[], i: number): string | null {
  const next = rows[i + 1]
  // The gap is inside a child group only if the row after it is itself a child.
  if (!next || next.depth === 0) return null
  for (let j = i; j >= 0; j--) {
    if (rows[j]!.depth === 0) return rows[j]!.id
  }
  return null
}

/**
 * The project group row `i` sits in — the nearest divider above it. This is the
 * same rule `dropFromRows` uses to resolve a drop, so a seam offers exactly the
 * group a drop into that gap would land in.
 */
function groupAt(rows: readonly ProjectRow[], i: number): string | null {
  for (let j = i; j >= 0; j--) {
    const r = rows[j]!
    if (r.kind === 'divider') return r.projectId
  }
  return null
}

/**
 * `seamParentId` for the project list. Rank scopes are sibling scopes, NOT
 * project groups: a child's rank still compares only against its siblings, so
 * grouping must not be mistaken for nesting. The walk stops at a divider —
 * a root above a group header is in a different group and cannot be the parent
 * of anything below it.
 */
function projectSeamParentId(rows: readonly ProjectRow[], i: number): string | null {
  const next = rows[i + 1]
  if (!next || next.kind !== 'item' || next.row.depth === 0) return null
  for (let j = i; j >= 0; j--) {
    const r = rows[j]!
    if (r.kind === 'divider') return null
    if (r.row.depth === 0) return r.row.id
  }
  return null
}

/**
 * The hover seam between two rows. An overlay, never a layout change — the gap
 * must not resize on hover or the whole grid twitches as the pointer moves.
 */
function Seam({
  afterId,
  beforeId,
  parentId,
  projectId,
  interaction,
}: {
  afterId: string | null
  beforeId: string | null
  parentId: string | null
  /** Set by Project-view seams; absent in Priority view, which has no groups. */
  projectId?: string | null
  interaction: GridInteraction
}): JSX.Element | null {
  if (!interaction.onInsertBetween) return null
  return (
    <div
      className="ws-seam"
      onClick={() => interaction.onInsertBetween?.(afterId, beforeId, parentId, projectId)}
      title="Insert an item here"
    >
      <span className="ws-seam-plus">+</span>
      <span className="ws-seam-line" />
    </div>
  )
}

/**
 * A project group header. Spans the full grid width so the week columns stay
 * uninterrupted behind it.
 */
function DividerRow({
  divider,
  interaction,
}: {
  divider: Extract<ProjectRow, { kind: 'divider' }>
  interaction: GridInteraction
}): JSX.Element {
  return (
    <div className="ws-divider" data-divider-key={dividerKey(divider.projectId)}>
      <button
        className="ws-divider-disclosure"
        type="button"
        aria-expanded={!divider.collapsed}
        onClick={() => interaction.onToggleGroup?.(divider.projectId)}
        title={divider.collapsed ? 'Expand' : 'Collapse'}
      >
        {divider.collapsed ? '▸' : '▾'}
      </button>
      {/* The unassigned bucket gets the same affordance as a real project.
          Its colour just lives per-device rather than in the file. */}
      <button
        className={`ws-divider-swatch${divider.colorToken ? '' : ' ws-divider-swatch--none'}`}
        type="button"
        style={
          divider.colorToken ? { background: `var(--ws-${kebab(divider.colorToken)})` } : undefined
        }
        title="Change colour"
        aria-label={`Change colour for ${divider.name}`}
        onClick={(e) => interaction.onPickColor?.(divider.projectId, e.clientX, e.clientY)}
      />
      {divider.projectId !== null && interaction.editingProjectId === divider.projectId ? (
        <span className="ws-divider-name ws-divider-name--editing">
          <InlineEdit
            initial={divider.name}
            placeholder="Project name…"
            onCommit={(t) => interaction.onCommitRenameProject?.(t)}
            onCancel={() => interaction.onCancelRenameProject?.()}
          />
        </span>
      ) : (
        <span
          className={`ws-divider-name${divider.projectId !== null ? ' ws-divider-name--editable' : ''}`}
          {...(divider.projectId !== null && interaction.onStartRenameProject
            ? {
                onClick: () => interaction.onStartRenameProject?.(divider.projectId as string),
                title: 'Click to rename',
              }
            : {})}
        >
          {divider.name}
        </span>
      )}
      <span className="ws-divider-meta">{divider.meta}</span>
      {/* Real projects only — the unassigned bucket is not a thing you can
          delete, it is where things go when they belong to nothing.
          Hover-revealed on purpose: retiring a project is rare, and a
          permanently visible × beside every group is an accident waiting for a
          stray click. */}
      {divider.projectId !== null && interaction.onDeleteProject ? (
        <button
          className="ws-divider-delete"
          type="button"
          title={`Delete project ${divider.name}`}
          aria-label={`Delete project ${divider.name}`}
          onClick={() => interaction.onDeleteProject?.(divider.projectId as string)}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

/** An unsaved new item, rendered as an ordinary row so it reads the same. */
function DraftRow({
  interaction,
  depth,
}: {
  interaction: GridInteraction
  depth: 0 | 1
}): JSX.Element {
  return (
    <div className="ws-row ws-row--draft">
      <div className="ws-grip" />
      <div className="ws-bar" />
      <div className={`ws-title ws-title--draft${depth === 1 ? ' ws-title--child' : ''}`}>
        <InlineEdit
          initial=""
          onCommit={(t) => interaction.onCommitEdit?.(t)}
          onCancel={() => interaction.onCancelEdit?.()}
        />
      </div>
    </div>
  )
}

/** `barA` -> `bar-a`, matching the CSS custom-property naming. */
function kebab(token: string): string {
  return token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

export function Grid({ vm, ...interaction }: { vm: GridVM } & GridInteraction): JSX.Element {
  const style = { ['--ws-grid-columns' as string]: columnTemplate(vm.weeks.length) }

  return (
    <div className="ws-grid" style={style}>
      <div className="ws-head-item">
        <span>ITEM</span>
        {interaction.onSortByDate ? (
          <button
            className="ws-head-sort"
            type="button"
            onClick={() => interaction.onSortByDate?.()}
            title="Sort by date — done, then due, then unscheduled"
            aria-label="Sort by date"
          >
            {/* Two arrows chasing each other round a circle. Drawn as two arcs
                with their own arrowheads rather than a font glyph, which would
                not be available offline in the single-file build. */}
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M2.6 6.4a5.6 5.6 0 0 1 9.5-2.2M13.4 9.6a5.6 5.6 0 0 1-9.5 2.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path d="M12.6 1.2v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.4 14.8v-3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>
      {vm.weeks.map((week) => (
        <WeekHeader
          week={week}
          {...(interaction.onCloseOut ? { onCloseOut: interaction.onCloseOut } : {})}
          key={week.week}
        />
      ))}

      <div className="ws-head-blank" />
      {vm.weeks.map((week) =>
        [...week.weekdays, ...week.weekend].map((day) => (
          <DayHeader
            day={day}
            isPast={week.isPast}
            {...(interaction.onToggleVacation ? { onToggleVacation: interaction.onToggleVacation } : {})}
            key={day.date}
          />
        )),
      )}

      {interaction.projectRows
        ? interaction.projectRows.map((pr, i) => {
            if (pr.kind === 'divider') {
              const first = interaction.projectRows![i + 1]
              return (
                <Fragment key={`d-${pr.projectId ?? 'none'}`}>
                  <DividerRow divider={pr} interaction={interaction} />
                  {/* A seam directly under the header is the only way to create
                      the FIRST item of a group — and the only way to put
                      anything into a group that is currently empty. */}
                  {pr.collapsed ? null : (
                    <Seam
                      afterId={null}
                      beforeId={first && first.kind === 'item' ? first.row.id : null}
                      parentId={null}
                      projectId={pr.projectId}
                      interaction={interaction}
                    />
                  )}
                  {interaction.draftSlot === `group:${dividerKey(pr.projectId)}` ? (
                    <DraftRow interaction={interaction} depth={0} />
                  ) : null}
                </Fragment>
              )
            }
            // The group this row sits in, and whether it is the last row of it.
            // Both come from scanning the rendered list, so a seam always offers
            // the group the user can see above it.
            const group = groupAt(interaction.projectRows!, i)
            const next = interaction.projectRows![i + 1]
            const lastOfGroup = !next || next.kind === 'divider'
            return (
              <Fragment key={pr.row.id}>
                <Row
                  row={pr.row}
                  interaction={interaction}
                  dragging={interaction.draggingId === pr.row.id}
                />
                {interaction.draftSlot === `after:${pr.row.id}` ? (
                  <DraftRow interaction={interaction} depth={pr.row.depth} />
                ) : null}
                <Seam
                  afterId={pr.row.id}
                  // At the foot of a group there is no next row to name, and
                  // `null` means exactly that — "no upper bound named", NOT
                  // "above everything". `rankForInsert` resolves the real bound
                  // from the rank scope. Reading it as infinity is what let two
                  // groups mint the same key: a group is not a rank scope, so
                  // its last item is not the spine's last item.
                  beforeId={lastOfGroup ? null : (next.kind === 'item' ? next.row.id : null)}
                  // Rank scope is sibling-scoped exactly as in Priority view;
                  // a project group is not a rank scope.
                  parentId={projectSeamParentId(interaction.projectRows!, i)}
                  projectId={group}
                  interaction={interaction}
                />
              </Fragment>
            )
          })
        : null}
      {interaction.projectRows ? null : (interaction.previewRows ?? vm.rows).map((row, i, arr) => (
        <Fragment key={row.id}>
          {i === 0 ? (
            <Fragment>
              <Seam afterId={null} beforeId={row.id} parentId={null} interaction={interaction} />
              {interaction.draftSlot === 'top' ? (
                <DraftRow interaction={interaction} depth={0} />
              ) : null}
            </Fragment>
          ) : null}
          <Row
            row={row}
            interaction={interaction}
            dragging={interaction.draggingId === row.id}
          />
          {interaction.draftSlot === `after:${row.id}` ? (
            <DraftRow interaction={interaction} depth={row.depth} />
          ) : null}
          <Seam
            afterId={row.id}
            beforeId={arr[i + 1]?.id ?? null}
            // Ranks are sibling-scoped, so a new item must join the scope the gap
            // actually sits in. RowVM carries `depth`, not a parent id, so the
            // parent is the nearest preceding root.
            parentId={seamParentId(arr, i)}
            interaction={interaction}
          />
        </Fragment>
      ))}

      {/* A button, not a caption. It advertised a keyboard shortcut and then
          ignored the obvious click — the one interaction its own "+" invites. */}
      <button className="ws-addrow" type="button" onClick={() => interaction.onAddItem?.()}>
        <span className="ws-addrow-plus">+</span>
        <span>add item</span>
        <span className="ws-addrow-kbd">N</span>
      </button>

    </div>
  )
}
