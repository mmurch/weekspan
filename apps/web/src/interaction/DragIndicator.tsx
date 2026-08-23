/**
 * The horizontal insertion line shown while a grip drag (`useDragReorder`) is
 * in progress — the only visual feedback for where a drop would land.
 *
 * Presentational and read-only: it derives its position from `DragState` plus
 * live DOM measurement, and writes nothing. Render it as a sibling of
 * `<Grid>` anywhere in the document — it is `position: fixed` and needs no
 * particular positioning context, so it does not require any change to
 * `Grid.tsx` or `Grid.css`.
 */

import { useLayoutEffect, useState } from 'react'
import type { GridVM } from '../grid/viewModel.js'
import type { DragState } from './useDragReorder.js'
import './DragIndicator.css'

export interface DragIndicatorProps {
  vm: GridVM
  state: DragState
}

interface LinePosition {
  top: number
  left: number
  width: number
}

function lastRowElement(grid: Element): Element | null {
  const rows = grid.querySelectorAll('[data-row-id]')
  return rows.length > 0 ? rows[rows.length - 1]! : null
}

/** `CSS.escape` when available; a conservative manual fallback otherwise. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

/**
 * Rows are `display: contents` — the wrapper generates NO box, so measuring
 * `[data-row-id]` directly returns {top:0, height:0} for every row and every
 * drop resolves to the same index. That is a direct consequence of the grid's
 * alignment technique: making cells join the parent grid is exactly what stops
 * the row from having geometry of its own.
 *
 * So measure a real child instead. `.ws-title` spans the full row height (grid
 * items stretch to the row), which is precisely the extent a drop needs.
 */
function rowBox(row: Element): DOMRect | null {
  const measurable = row.querySelector('.ws-title') ?? row.querySelector('.ws-cell')
  return measurable ? measurable.getBoundingClientRect() : null
}

export function DragIndicator({ vm, state }: DragIndicatorProps): JSX.Element | null {
  const [line, setLine] = useState<LinePosition | null>(null)

  useLayoutEffect(() => {
    if (state.draggingId === null || state.overIndex === null) {
      setLine(null)
      return
    }

    const grid = document.querySelector('.ws-grid')
    if (!grid) {
      setLine(null)
      return
    }
    const gridRect = grid.getBoundingClientRect()
    const targetRow = vm.rows[state.overIndex]

    let top: number | null = null
    if (targetRow) {
      const el = grid.querySelector(`[data-row-id="${cssEscape(targetRow.id)}"]`)
      const r = el ? rowBox(el) : null
      if (r) top = r.top
    } else {
      // Past the last row: sit right above the add-item affordance, or below
      // the last measured row if that affordance is not present for some reason.
      const addRow = grid.querySelector('.ws-addrow')
      if (addRow) {
        top = addRow.getBoundingClientRect().top
      } else {
        const last = lastRowElement(grid)
        const lr = last ? rowBox(last) : null
        if (lr) top = lr.bottom
      }
    }

    setLine(top === null ? null : { top, left: gridRect.left, width: gridRect.width })
  }, [vm, state.draggingId, state.overIndex])

  if (!line) return null

  return (
    <div
      className={`ws-drag-indicator${state.validDrop ? '' : ' ws-drag-indicator--invalid'}`}
      style={{ top: line.top, left: line.left, width: line.width }}
    />
  )
}
