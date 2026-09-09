import { useCallback, useEffect, useRef, useState } from 'react'
import type { IsoDate } from '@weekspan/weekspan-core'
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
import { autoScrollDelta, autoScrollDeltaX } from './autoscroll.js'
import { dateForX, measureColumns, type ColumnBox } from './markDrag.js'

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
 *
 * TWO GRIPS, ONE GESTURE. The item column's grip drags vertically. A mark chip
 * (`markHandlers`) drags on both axes: vertically it is the identical reorder,
 * and horizontally the column under the pointer becomes the mark's new day (see
 * `markDrag.ts`). Diagonal is not a third mode — the axes are resolved
 * independently every frame and committed together, as one write, so a chip
 * dragged down and across produces a single undo step rather than two.
 * Everything the two share (threshold, auto-scroll, Escape, the previewed row
 * order) is shared literally, by being the same code.
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
  /**
   * The in-flight mark drag, or null when nothing (or only a grip) is being
   * dragged. `to` tracks the pointer's column live, so the grid can draw the
   * chip on the day it would land on — the preview IS the answer here too.
   */
  markDrag: { itemId: string; from: IsoDate; to: IsoDate } | null
}

/** What a released mark drag asks the caller to write. */
export interface MarkDrop<T> {
  itemId: string
  /** The day the chip was picked up from. */
  from: IsoDate
  /** The day it was dropped on. Equal to `from` when the drag was purely vertical. */
  to: IsoDate
  /** Row order at release — the list on screen, same contract as `commit`. */
  previewed: readonly T[]
  /** False when the drag was purely horizontal and the row never changed place. */
  reorder: boolean
}

const MOVE_THRESHOLD = 4

/**
 * The app's single scroll surface (see `.ws-scroll` — "Sticky header cells and
 * the frozen item column position against THIS box, so it must own both axes").
 * Auto-scroll drives it directly; there is deliberately no second scroller to
 * disambiguate between.
 */
const SCROLLER_SELECTOR = '.ws-scroll'

/**
 * The frozen item column, which is `position: sticky` and so overlays the left
 * of the scroll box rather than scrolling out of it. Its right edge is where
 * the day columns actually begin, and therefore where horizontal auto-scroll's
 * left zone has to start — see `autoScrollDeltaX`.
 */
const FROZEN_COLUMN_SELECTOR = '.ws-head-item'

export function useDragPreview<T, B>(
  adapter: DragAdapter<T, B> | null,
  onMarkDrop?: (drop: MarkDrop<T>) => void,
): {
  state: DragPreviewState<T>
  gripHandlers: (itemId: string) => { onPointerDown: (e: React.PointerEvent) => void }
  markHandlers: (
    itemId: string,
    date: IsoDate,
  ) => { onPointerDown: (e: React.PointerEvent) => void }
} {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewed, setPreviewed] = useState<T[] | null>(null)
  const [markDrag, setMarkDrag] = useState<{ itemId: string; from: IsoDate; to: IsoDate } | null>(
    null,
  )

  const boxes = useRef<B | null>(null)
  /** Day columns, measured at pointerdown alongside `boxes`. Empty for a grip drag. */
  const columns = useRef<ColumnBox[]>([])
  const startY = useRef(0)
  const startX = useRef(0)
  /**
   * Scroll offset when `boxes` was measured. Every box is a viewport rect, so
   * scrolling invalidates all of them by exactly this delta — which is why the
   * pointer is corrected by it below instead of re-measuring every frame.
   */
  const scrollAtStart = useRef(0)
  /** Same correction as `scrollAtStart`, for the horizontal axis. */
  const scrollLeftAtStart = useRef(0)
  const moved = useRef(false)
  const latest = useRef<T[] | null>(null)
  /**
   * Mirrors `markDrag` for `end`, which must read the FINAL day without taking
   * the state as a dependency — doing so would rebuild `end` on every column
   * the pointer crosses and tear down the in-flight listeners with it.
   */
  const latestMark = useRef<{ itemId: string; from: IsoDate; to: IsoDate } | null>(null)
  const cancelled = useRef(false)

  // The adapter closes over the current rows, so it is a new object every
  // render. Holding it in a ref keeps the pointer effect from tearing down and
  // rebinding mid-drag, which would drop the in-flight listeners the moment the
  // first preview re-rendered the grid.
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const markDropRef = useRef(onMarkDrop)
  markDropRef.current = onMarkDrop

  const end = useCallback(
    (commit: boolean) => {
      const id = draggingId
      const rows = latest.current
      const mark = latestMark.current
      const a = adapterRef.current
      setDraggingId(null)
      setPreviewed(null)
      setMarkDrag(null)
      latest.current = null
      latestMark.current = null

      if (!commit || !id || !rows || !a || cancelled.current) return
      // A drag that did not actually move must write nothing — no diff in a
      // synced folder for a gesture that was really a click.
      if (!moved.current) return

      const reorder = !a.unchanged(rows)

      if (mark) {
        // Either axis alone is a real edit; neither is a no-op release. Both
        // go out as ONE drop so the caller writes them in a single mutation.
        if (!reorder && mark.to === mark.from) return
        markDropRef.current?.({
          itemId: id,
          from: mark.from,
          to: mark.to,
          previewed: rows,
          reorder,
        })
        return
      }

      // A grip drag that landed back where it started.
      if (!reorder) return
      a.commit(id, rows)
    },
    [draggingId],
  )

  useEffect(() => {
    if (draggingId === null) return

    const scroller = document.querySelector<HTMLElement>(SCROLLER_SELECTOR)
    const frozenWidth =
      document.querySelector<HTMLElement>(FROZEN_COLUMN_SELECTOR)?.getBoundingClientRect().width ?? 0
    let pointerY = startY.current
    let pointerX = startX.current
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

      // The horizontal half, resolved independently and from the SAME pointer
      // position, which is what makes a diagonal drag read as one motion
      // rather than as two gestures fighting for it.
      const mark = latestMark.current
      if (!mark) return
      const deltaX = scroller ? scroller.scrollLeft - scrollLeftAtStart.current : 0
      const to = dateForX(columns.current, pointerX + deltaX)
      if (to === null || to === mark.to) return
      const next = { ...mark, to }
      latestMark.current = next
      setMarkDrag(next)
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
        const rect = scroller.getBoundingClientRect()
        let scrolled = false

        const dy = autoScrollDelta(rect, pointerY)
        if (dy !== 0) {
          const before = scroller.scrollTop
          scroller.scrollTop += dy
          scrolled ||= scroller.scrollTop !== before
        }

        // Horizontal only matters for a mark drag — a grip drag ignores x, and
        // scrolling the grid sideways under a row being reordered would be
        // motion nobody asked for.
        if (latestMark.current) {
          const dx = autoScrollDeltaX({ left: rect.left + frozenWidth, right: rect.right }, pointerX)
          if (dx !== 0) {
            const before = scroller.scrollLeft
            scroller.scrollLeft += dx
            scrolled ||= scroller.scrollLeft !== before
          }
        }

        if (scrolled) recompute()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onMove = (e: PointerEvent): void => {
      pointerY = e.clientY
      pointerX = e.clientX
      // Distance, not per-axis: a mark drag is meaningful on either axis, so a
      // purely sideways gesture has to count as movement. For a grip drag,
      // which ignores x, this only ever lets one through that `unchanged` then
      // rejects anyway.
      if (Math.hypot(e.clientX - startX.current, e.clientY - startY.current) > MOVE_THRESHOLD) {
        moved.current = true
      }
      recompute()
    }
    const onUp = (): void => {
      /*
       * A pointerup on a chip is still followed by a `click` on the cell
       * underneath, which would select or cycle the very mark just dropped.
       * One capture-phase listener eats exactly that click and then removes
       * itself. Guarded on `moved` so a chip that was only clicked still
       * reaches the cell and cycles, as it always has.
       */
      if (moved.current && latestMark.current) {
        window.addEventListener(
          'click',
          (ev: MouseEvent) => {
            ev.stopPropagation()
            ev.preventDefault()
          },
          { capture: true, once: true },
        )
      }
      end(true)
    }
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

  /**
   * Shared pointerdown for both grips. `from` is the chip's day for a mark
   * drag, and `null` for the item-column grip, which has no day.
   */
  const begin = useCallback((itemId: string, from: IsoDate | null, e: React.PointerEvent): void => {
    const a = adapterRef.current
    if (e.button !== 0 || !a) return
    e.preventDefault()
    // Measure once, at pointerdown: rows are display:contents and have no box
    // of their own, so this reads .ws-title heights (see dragPreview.ts).
    boxes.current = a.measure()
    columns.current = from === null ? [] : measureColumns()
    const scroller = document.querySelector<HTMLElement>(SCROLLER_SELECTOR)
    scrollAtStart.current = scroller?.scrollTop ?? 0
    scrollLeftAtStart.current = scroller?.scrollLeft ?? 0
    startY.current = e.clientY
    startX.current = e.clientX
    moved.current = false
    cancelled.current = false
    latest.current = null
    const mark = from === null ? null : { itemId, from, to: from }
    latestMark.current = mark
    setMarkDrag(mark)
    setDraggingId(itemId)
    setPreviewed([...a.rows])
  }, [])

  const gripHandlers = useCallback(
    (itemId: string) => ({
      onPointerDown: (e: React.PointerEvent): void => begin(itemId, null, e),
    }),
    [begin],
  )

  const markHandlers = useCallback(
    (itemId: string, date: IsoDate) => ({
      onPointerDown: (e: React.PointerEvent): void => {
        // The chip sits inside a cell that has its own click handlers (select,
        // cycle, menu). Stopping propagation here keeps the cell's own
        // mousedown out of it; the CLICK that a release still produces is
        // swallowed separately, and only when the gesture actually moved — see
        // the pointerup handler — so a plain click on a chip still cycles it.
        e.stopPropagation()
        begin(itemId, date, e)
      },
    }),
    [begin],
  )

  return {
    state: { draggingId, rows: previewed ?? [...(adapter?.rows ?? [])], markDrag },
    gripHandlers,
    markHandlers,
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
