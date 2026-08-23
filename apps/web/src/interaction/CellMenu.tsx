import { useEffect, useRef } from 'react'
import type { IsoDate } from '@weekspan/weekspan-core'
import './CellMenu.css'

/**
 * The right-click cell menu (design handoff "4. Cell menu & vacation", #3d).
 *
 * Deliberately minimal: three entries only, each with a colour swatch
 * matching the chip it produces. Presentational only — no store access, no
 * domain logic. The caller owns the mutation (via `useWeekspan.mutate`) and
 * passes it in as `onMarkDone` / `onSetDue` / `onClear`.
 */

export interface CellMenuCell {
  itemId: string
  date: IsoDate
}

export interface CellMenuPosition {
  /** Viewport coordinates, e.g. straight from a `contextmenu` event. */
  x: number
  y: number
}

export interface CellMenuProps {
  position: CellMenuPosition
  cell: CellMenuCell
  onMarkDone: (cell: CellMenuCell) => void
  onSetDue: (cell: CellMenuCell) => void
  onClear: (cell: CellMenuCell) => void
  onClose: () => void
}

export function CellMenu({
  position,
  cell,
  onMarkDone,
  onSetDue,
  onClear,
  onClose,
}: CellMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // Closes on Escape and on any pointer-down outside the menu. Capture phase
  // so it beats a click handler on whatever is underneath.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent): void {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ws-cellmenu"
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        role="menuitem"
        className="ws-cellmenu-item"
        onClick={() => onMarkDone(cell)}
      >
        <span className="ws-cellmenu-swatch ws-cellmenu-swatch--done" />
        <span className="ws-cellmenu-label">Mark done</span>
        <span className="ws-cellmenu-key">V</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="ws-cellmenu-item"
        onClick={() => onSetDue(cell)}
      >
        <span className="ws-cellmenu-swatch ws-cellmenu-swatch--due" />
        <span className="ws-cellmenu-label">Set due</span>
        <span className="ws-cellmenu-key">D</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="ws-cellmenu-item"
        onClick={() => onClear(cell)}
      >
        <span className="ws-cellmenu-swatch ws-cellmenu-swatch--clear" />
        <span className="ws-cellmenu-label">Clear</span>
        <span className="ws-cellmenu-key">X</span>
      </button>
    </div>
  )
}
