import type { CellVM, DayColumn, GridVM, RowVM, WeekBlock } from './viewModel.js'
import type React from 'react'
import type { IsoDate } from '@weekspan/weekspan-core'

export interface GridInteraction {
  /** Currently selected cell, or null. */
  selection?: { itemId: string; date: IsoDate } | null
  onSelectCell?: (itemId: string, date: IsoDate) => void
  onContextCell?: (itemId: string, date: IsoDate, x: number, y: number) => void
  /** Fired by the week close affordance. */
  onCloseOut?: (week: string) => void
  /** Pointer handlers for the drag grip, from `useDragReorder`. */
  gripHandlers?: (itemId: string) => { onPointerDown: (e: React.PointerEvent) => void }
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

function DayHeader({ day, isPast }: { day: DayColumn; isPast: boolean }): JSX.Element {
  const cls = [
    'ws-day',
    day.isWeekend ? 'ws-day--weekend' : '',
    isPast ? 'ws-day--past' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (day.isToday) {
    return (
      <div className={cls}>
        <span className="ws-day-disc">
          <span>{day.letter}</span>
          <span>{day.dayOfMonth}</span>
        </span>
      </div>
    )
  }
  if (day.isVacation) {
    return (
      <div className={cls}>
        <span className="ws-day-disc ws-day-disc--vacation">
          <span>{day.letter}</span>
          <span>{day.dayOfMonth}</span>
        </span>
      </div>
    )
  }
  return (
    <div className={cls}>
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
  onSelect,
  onContext,
}: {
  cell: CellVM
  itemId: string
  selected: boolean
  onSelect?: (itemId: string, date: IsoDate) => void
  onContext?: (itemId: string, date: IsoDate, x: number, y: number) => void
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
    <div
      className={cls}
      data-cell-date={cell.date}
      onClick={() => onSelect?.(itemId, cell.date)}
      onContextMenu={(e) => {
        if (!onContext) return
        e.preventDefault()
        onContext(itemId, cell.date, e.clientX, e.clientY)
      }}
    >
      <Chip cell={cell} />
    </div>
  )
}

function Row({ row, interaction }: { row: RowVM; interaction: GridInteraction }): JSX.Element {
  const titleCls = [
    'ws-title',
    row.state === 'finished' ? 'ws-title--finished' : '',
    row.depth === 1 ? 'ws-title--child' : '',
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
    <div className="ws-row" data-row-id={row.id}>
      <div
        className="ws-grip"
        {...(interaction.gripHandlers ? interaction.gripHandlers(row.id) : {})}
      >
        ⠿⠿
      </div>
      <div className="ws-bar" style={barStyle} />
      <div className={titleCls}>
        {row.depth === 1 ? <span className="ws-elbow" /> : null}
        <span className={textCls}>{row.title}</span>
        {row.notes ? (
          <span className="ws-notes">
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
          {...(interaction.onSelectCell ? { onSelect: interaction.onSelectCell } : {})}
          {...(interaction.onContextCell ? { onContext: interaction.onContextCell } : {})}
          key={cell.date}
        />
      ))}
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
      <div className="ws-head-item">ITEM</div>
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
          <DayHeader day={day} isPast={week.isPast} key={day.date} />
        )),
      )}

      {vm.rows.map((row) => (
        <Row row={row} interaction={interaction} key={row.id} />
      ))}

      <div className="ws-addrow">
        <span className="ws-addrow-plus">+</span>
        <span>add item</span>
        <span className="ws-addrow-kbd">N</span>
      </div>

    </div>
  )
}
