import { useCallback, useEffect, useRef, useState } from 'react'
import type { GridVM, RowVM } from '../grid/viewModel.js'
import type { ProjectRow } from '../grid/projectView.js'
import {
  commitNeighbours,
  isUnchanged,
  measureRows,
  previewIndexFor,
  previewRows,
  type RowBox,
} from './dragPreview.js'
import {
  isProjectUnchanged,
  measureProjectRows,
  previewProjectIndexFor,
  previewProjectRows,
  type ProjectRowBox,
} from './projectDragPreview.js'
import { autoScrollDelta } from './autoscroll.js'

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
 *
 * The pointer lifecycle — threshold, lift offset, Escape to cancel, commit on
 * release — is identical in both views, so it lives here once and the row shape
 * comes from a `DragAdapter`. Project view previously had no adapter at all: the
 * hook was handed Priority view's rows while the commit read Project view's, so
 * the previewed list the commit wanted never existed and every drop resolved to
 * the item's own current neighbours — a guaranteed silent no-op.
 */

/**
 * Everything a view must say about its own row list. The hook owns WHEN things
 * happen; the adapter owns what a row is, where it may land, and what a drop
 * means. `B` — whatever `measure` produces — stays opaque to the hook, so each
 * view keeps its own box shape without a cast at the boundary.
 */
export interface DragAdapter<T, B> {
  /** The committed row list — what is on screen when no drag is in flight. */
  rows: readonly T[]
  /** Measure the rendered rows. Called once, at pointerdown. */
  measure: () => B
  /** Insertion index for the pointer, into the list with the dragged group removed. */
  indexFor: (boxes: B, draggingId: string, pointerY: number) => number
  /** The list to render mid-drag. */
  apply: (draggingId: string, index: number) => T[]
  /** True when the previewed order is where the row already was — write nothing. */
  unchanged: (previewed: readonly T[]) => boolean
  /** Commit the drop, reading its neighbours from the previewed list. */
  commit: (draggingId: string, previewed: readonly T[]) => void
}

export interface DragPreviewState<T> {
  draggingId: string | null
  /** Rows in prospective order — render THESE while dragging. */
  rows: T[]
}

const MOVE_THRESHOLD = 4

/**
 * The app's single scroll surface (see `.ws-scroll` — "Sticky header cells and
 * the frozen item column position against THIS box, so it must own both axes").
 * Auto-scroll drives it directly; there is deliberately no second scroller to
 * disambiguate between.
 */
const SCROLLER_SELECTOR = '.ws-scroll'

export function useDragPreview<T, B>(
  adapter: DragAdapter<T, B> | null,
): {
  state: DragPreviewState<T>
  gripHandlers: (itemId: string) => { onPointerDown: (e: React.PointerEvent) => void }
} {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewed, setPreviewed] = useState<T[] | null>(null)

  const boxes = useRef<B | null>(null)
  const startY = useRef(0)
  /**
   * Scroll offset when `boxes` was measured. Every box is a viewport rect, so
   * scrolling invalidates all of them by exactly this delta — which is why the
   * pointer is corrected by it below instead of re-measuring every frame.
   */
  const scrollAtStart = useRef(0)
  const moved = useRef(false)
  const latest = useRef<T[] | null>(null)
  const cancelled = useRef(false)

  // The adapter closes over the current rows, so it is a new object every
  // render. Holding it in a ref keeps the pointer effect from tearing down and
  // rebinding mid-drag, which would drop the in-flight listeners the moment the
  // first preview re-rendered the grid.
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const end = useCallback(
    (commit: boolean) => {
      const id = draggingId
      const rows = latest.current
      const a = adapterRef.current
      setDraggingId(null)
      setPreviewed(null)
      latest.current = null

      if (!commit || !id || !rows || !a || cancelled.current) return
      // A drag that did not actually move, or that landed back where it started,
      // must write nothing — no diff in a synced folder for a no-op gesture.
      if (!moved.current || a.unchanged(rows)) return
      a.commit(id, rows)
    },
    [draggingId],
  )

  useEffect(() => {
    if (draggingId === null) return

    const scroller = document.querySelector<HTMLElement>(SCROLLER_SELECTOR)
    let pointerY = startY.current
    let raf = 0

    /**
     * Resolve the preview for the current pointer position.
     *
     * `boxes` are viewport rects captured once at pointerdown, so anything that
     * scrolls since invalidates all of them by the same delta. Adding that delta
     * to the pointer is algebraically identical to subtracting it from every box
     * (`pointerY > box.top - delta + h/2`  ⟺  `pointerY + delta > box.top + h/2`)
     * and costs one subtraction instead of re-querying every row each frame.
     */
    const recompute = (): void => {
      const a = adapterRef.current
      const b = boxes.current
      if (!a || b === null) return
      const delta = scroller ? scroller.scrollTop - scrollAtStart.current : 0
      const rows = a.apply(draggingId, a.indexFor(b, draggingId, pointerY + delta))
      latest.current = rows
      setPreviewed(rows)
    }

    /**
     * Auto-scroll runs off rAF rather than off pointermove: holding the pointer
     * still inside the edge zone must keep scrolling, and a stationary pointer
     * emits no move events at all. Recomputing only when the scroll position
     * actually changed keeps this from re-rendering the grid every frame once
     * the container is already pinned at an end.
     */
    const tick = (): void => {
      if (scroller) {
        const delta = autoScrollDelta(scroller.getBoundingClientRect(), pointerY)
        if (delta !== 0) {
          const before = scroller.scrollTop
          scroller.scrollTop += delta
          if (scroller.scrollTop !== before) recompute()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onMove = (e: PointerEvent): void => {
      pointerY = e.clientY
      if (Math.abs(e.clientY - startY.current) > MOVE_THRESHOLD) moved.current = true
      recompute()
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
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [draggingId, end])

  const gripHandlers = useCallback(
    (itemId: string) => ({
      onPointerDown: (e: React.PointerEvent): void => {
        const a = adapterRef.current
        if (e.button !== 0 || !a) return
        e.preventDefault()
        // Measure once, at pointerdown: rows are display:contents and have no box
        // of their own, so this reads .ws-title heights (see dragPreview.ts).
        boxes.current = a.measure()
        scrollAtStart.current =
          document.querySelector<HTMLElement>(SCROLLER_SELECTOR)?.scrollTop ?? 0
        startY.current = e.clientY
        moved.current = false
        cancelled.current = false
        latest.current = null
        setDraggingId(itemId)
        setPreviewed([...a.rows])
      },
    }),
    [],
  )

  return {
    state: { draggingId, rows: previewed ?? [...(adapter?.rows ?? [])] },
    gripHandlers,
  }
}

/** Priority view: a flat `RowVM[]`, neighbours constrained by nesting depth. */
export function priorityAdapter(
  vm: GridVM | null,
  onCommit: (itemId: string, beforeId: string | null, afterId: string | null) => void,
): DragAdapter<RowVM, RowBox[]> | null {
  if (!vm) return null
  return {
    rows: vm.rows,
    measure: () => measureRows(vm),
    indexFor: (b, id, y) => previewIndexFor(vm.rows, b, id, y),
    apply: (id, index) => previewRows(vm.rows, id, index),
    unchanged: (p) => isUnchanged(vm.rows, p),
    commit: (id, p) => {
      const n = commitNeighbours(p, id)
      if (!n) return
      onCommit(id, n.beforeId, n.afterId)
    },
  }
}

/**
 * Project view: rows interleaved with dividers. A drop here carries a GROUP as
 * well as a rank, and the group is read from the divider above the row's
 * previewed position — so the commit hands the whole previewed list to
 * `dropFromRows` rather than naming two neighbours itself.
 */
export function projectAdapter(
  rows: readonly ProjectRow[] | null,
  onCommit: (itemId: string, previewed: readonly ProjectRow[]) => void,
): DragAdapter<ProjectRow, ProjectRowBox[]> | null {
  if (!rows) return null
  return {
    rows,
    measure: () => measureProjectRows(rows),
    indexFor: (b, id, y) => previewProjectIndexFor(rows, b, id, y),
    apply: (id, index) => previewProjectRows(rows, id, index),
    unchanged: (p) => isProjectUnchanged(rows, p),
    commit: onCommit,
  }
}
