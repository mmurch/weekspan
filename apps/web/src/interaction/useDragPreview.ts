import { useCallback, useEffect, useRef, useState } from 'react'
import type { GridVM, RowVM } from '../grid/viewModel.js'
import {
  commitNeighbours,
  isUnchanged,
  measureRows,
  previewIndexFor,
  previewRows,
  type RowBox,
} from './dragPreview.js'

/**
 * Drag with live preview.
 *
 * Replaces the insertion-line approach, which had two problems: the line drew at
 * the target row's top edge so it read as sitting ON a row rather than between
 * two, and the index it drew from could disagree with the neighbours the drop
 * committed — so the row landed somewhere other than promised.
 *
 * Now the grid re-renders in the prospective order as the pointer moves, and the
 * commit reads its neighbours from that same previewed array. There is no second
 * source of truth to drift.
 */

export interface DragPreviewState {
  draggingId: string | null
  /** Rows in prospective order — render THESE while dragging. */
  rows: RowVM[]
  /** Vertical offset to render the lifted row at, so it tracks the cursor. */
  liftY: number
}

const MOVE_THRESHOLD = 4

export function useDragPreview(
  vm: GridVM | null,
  onCommit: (itemId: string, beforeId: string | null, afterId: string | null) => void,
): {
  state: DragPreviewState
  gripHandlers: (itemId: string) => { onPointerDown: (e: React.PointerEvent) => void }
} {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewed, setPreviewed] = useState<RowVM[] | null>(null)
  const [liftY, setLiftY] = useState(0)

  const boxes = useRef<RowBox[]>([])
  const startY = useRef(0)
  const moved = useRef(false)
  const latest = useRef<RowVM[] | null>(null)
  const cancelled = useRef(false)

  const end = useCallback(
    (commit: boolean) => {
      const id = draggingId
      const rows = latest.current
      setDraggingId(null)
      setPreviewed(null)
      setLiftY(0)
      latest.current = null

      if (!commit || !id || !rows || !vm || cancelled.current) return
      // A drag that did not actually move, or that landed back where it started,
      // must write nothing — no diff in a synced folder for a no-op gesture.
      if (!moved.current || isUnchanged(vm.rows, rows)) return
      const n = commitNeighbours(rows, id)
      if (!n) return
      onCommit(id, n.beforeId, n.afterId)
    },
    [draggingId, vm, onCommit],
  )

  useEffect(() => {
    if (draggingId === null || !vm) return

    const onMove = (e: PointerEvent): void => {
      if (Math.abs(e.clientY - startY.current) > MOVE_THRESHOLD) moved.current = true
      setLiftY(e.clientY - startY.current)
      const index = previewIndexFor(vm.rows, boxes.current, draggingId, e.clientY)
      const rows = previewRows(vm.rows, draggingId, index)
      latest.current = rows
      setPreviewed(rows)
    }
    const onUp = (): void => end(true)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      cancelled.current = true
      end(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [draggingId, vm, end])

  const gripHandlers = useCallback(
    (itemId: string) => ({
      onPointerDown: (e: React.PointerEvent): void => {
        if (e.button !== 0 || !vm) return
        e.preventDefault()
        // Measure once, at pointerdown: rows are display:contents and have no box
        // of their own, so this reads .ws-title heights (see dragPreview.ts).
        boxes.current = measureRows(vm)
        startY.current = e.clientY
        moved.current = false
        cancelled.current = false
        latest.current = null
        setDraggingId(itemId)
        setPreviewed(vm.rows.slice())
      },
    }),
    [vm],
  )

  return {
    state: { draggingId, rows: previewed ?? vm?.rows.slice() ?? [], liftY },
    gripHandlers,
  }
}
