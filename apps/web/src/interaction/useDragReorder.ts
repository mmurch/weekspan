/**
 * Pointer-based drag-to-reorder for the Weekspan grid's rows.
 *
 * Deliberately NOT HTML5 drag-and-drop: HTML5 DnD cannot render a custom drop
 * indicator reliably and behaves poorly inside a scrolling grid (see the
 * design brief). This is a plain `pointerdown` / `pointermove` / `pointerup`
 * flow with `setPointerCapture`, so the dragged grip keeps receiving events
 * even once the pointer has left it.
 *
 * All ordering math is delegated. `dropTargetFor` (the pure half of this
 * module) never touches `Item.rank` — it resolves a drop to a pair of
 * NEIGHBOUR ROW IDS (`beforeId` / `afterId`) using only `GridVM.rows`, which
 * is already exactly what `orderItems` produces (parents immediately
 * followed by their own children, each block internally rank-sorted — see
 * `buildGrid` in ../grid/viewModel.ts). The caller turns those ids into real
 * `Item`s and calls `minimalMoveRank` (packages/weekspan-core/src/rank.ts) to
 * get a rank, writing nothing when it returns null. No rank logic is
 * reimplemented here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { GridVM, RowVM } from '../grid/viewModel.js'

export interface DragState {
  draggingId: string | null
  overIndex: number | null
  validDrop: boolean
}

const IDLE: DragState = { draggingId: null, overIndex: null, validDrop: false }

/** A row's vertical extent, in the same coordinate space as the pointer event (viewport px). */
export interface RowRect {
  top: number
  height: number
}

export type RowRects = ReadonlyMap<string, RowRect>

export interface DropTarget {
  /**
   * Index into `vm.rows` before which the dragged row would land. Equal to
   * the end of the dragged item's valid range (see `dropTargetFor`) when the
   * drop is at the very bottom of that range.
   */
  index: number
  /** Id of the row that would end up immediately before the dragged row, or null at the top of its range. */
  beforeId: string | null
  /** Id of the row that would end up immediately after the dragged row, or null at the bottom of its range. */
  afterId: string | null
}

interface Span {
  id: string
  /** Index into `vm.rows` of this candidate (its own row, or a root's group start). */
  index: number
  top: number
  bottom: number
}

/**
 * The `[start, end)` row-index span occupied by the row at `startIndex` and,
 * if it is a root, its children — the unit that travels together on a drag.
 */
function groupSpan(rows: readonly RowVM[], startIndex: number): [number, number] {
  let end = startIndex + 1
  if (rows[startIndex]!.depth === 0) {
    while (end < rows.length && rows[end]!.depth === 1) end++
  }
  return [startIndex, end]
}

/**
 * Pure geometry + ordering decision for a drag of `draggingId` currently over
 * `pointerY`. Testable without a DOM: `rowRects` stands in for measured
 * `getBoundingClientRect()` output.
 *
 * Nesting is one level and ranks are sibling-scoped, so the valid landing
 * range depends on what is being dragged:
 *   - a ROOT reorders only among other roots. Its children travel with it as
 *     one block, and hovering anywhere over another root's own children still
 *     reads as "before/after that whole group" (its full vertical span is
 *     used, not just its own row).
 *   - a CHILD reorders only among its own siblings (same parent). It can
 *     never resolve to a position outside that block, however far the
 *     pointer strays — so a drag can never produce a second level of nesting
 *     or make an item its own ancestor.
 *
 * Returns null only when `draggingId` does not name a row in `vm`.
 */
export function dropTargetFor(
  vm: GridVM,
  draggingId: string,
  pointerY: number,
  rowRects: RowRects,
): DropTarget | null {
  const rows = vm.rows
  const dragIndex = rows.findIndex((r) => r.id === draggingId)
  if (dragIndex === -1) return null
  const draggingRow = rows[dragIndex]!

  const [groupStart, groupEnd] = groupSpan(rows, dragIndex)
  const inDraggedGroup = (i: number): boolean => i >= groupStart && i < groupEnd

  const candidates: Span[] = []
  let rangeEnd: number

  if (draggingRow.depth === 0) {
    // Root scope: every OTHER root, measured across its whole group.
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.depth !== 0 || inDraggedGroup(i)) continue
      const [s, e] = groupSpan(rows, i)
      const top = rowRects.get(rows[s]!.id)?.top
      const lastRect = rowRects.get(rows[e - 1]!.id)
      if (top === undefined || lastRect === undefined) continue
      candidates.push({ id: rows[s]!.id, index: s, top, bottom: lastRect.top + lastRect.height })
    }
    rangeEnd = rows.length
  } else {
    // Child scope: only the dragged item's own siblings (same parent).
    let parentIndex = dragIndex
    while (parentIndex >= 0 && rows[parentIndex]!.depth !== 0) parentIndex--
    const [, parentGroupEnd] = groupSpan(rows, parentIndex)
    for (let i = parentIndex + 1; i < parentGroupEnd; i++) {
      if (inDraggedGroup(i)) continue
      const rect = rowRects.get(rows[i]!.id)
      if (rect === undefined) continue
      candidates.push({ id: rows[i]!.id, index: i, top: rect.top, bottom: rect.top + rect.height })
    }
    rangeEnd = parentGroupEnd
  }

  // `candidates` is already in rank order because `vm.rows` is (buildGrid
  // delegates ordering to `orderItems`).
  let after: Span | null = null
  for (const c of candidates) {
    if (pointerY < (c.top + c.bottom) / 2) {
      after = c
      break
    }
  }
  const afterPos = after ? candidates.indexOf(after) : candidates.length
  const before = afterPos > 0 ? candidates[afterPos - 1]! : null

  return {
    index: after ? after.index : rangeEnd,
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
  }
}

/** Below this many pixels of vertical travel, a pointerdown/up pair is a click, not a drag. */
const MOVE_THRESHOLD_PX = 4

interface DragSession {
  itemId: string
  pointerId: number
  startY: number
  moved: boolean
  rowRects: RowRects
  element: HTMLElement
  target: DropTarget | null
  onMove: (e: PointerEvent) => void
  onUp: (e: PointerEvent) => void
  onCancel: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

/**
 * Measures every rendered row's vertical extent, keyed by `data-row-id` — see
 * `Row` in ../grid/Grid.tsx. Scoped to the nearest `.ws-grid` ancestor so a
 * future second grid on the page (if one ever exists) cannot cross-contaminate.
 */
function measureRowRects(fromElement: HTMLElement): RowRects {
  const scope = fromElement.closest('.ws-grid') ?? document
  const rects = new Map<string, RowRect>()
  scope.querySelectorAll<HTMLElement>('[data-row-id]').forEach((el) => {
    const id = el.dataset['rowId']
    if (!id) return
    const rect = el.getBoundingClientRect()
    rects.set(id, { top: rect.top, height: rect.height })
  })
  return rects
}

/**
 * Thin React wrapper over `dropTargetFor`. Owns the pointer-capture gesture
 * and the "was this actually a drag" distinction; all the position math is
 * delegated to the pure function above.
 */
export function useDragReorder(
  vm: GridVM | null,
  onReorder: (itemId: string, beforeId: string | null, afterId: string | null) => void,
): {
  state: DragState
  gripHandlers: (itemId: string) => { onPointerDown: (e: React.PointerEvent) => void }
} {
  const [state, setState] = useState<DragState>(IDLE)

  // Read inside long-lived listeners via refs so a stale closure never fires
  // against an out-of-date `vm` or `onReorder` mid-gesture.
  const vmRef = useRef(vm)
  vmRef.current = vm
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder

  const sessionRef = useRef<DragSession | null>(null)

  const endSession = useCallback((commit: boolean) => {
    const s = sessionRef.current
    if (!s) return
    s.element.removeEventListener('pointermove', s.onMove)
    s.element.removeEventListener('pointerup', s.onUp)
    s.element.removeEventListener('pointercancel', s.onCancel)
    window.removeEventListener('keydown', s.onKeyDown)
    if (s.element.hasPointerCapture(s.pointerId)) s.element.releasePointerCapture(s.pointerId)
    sessionRef.current = null
    setState(IDLE)

    // A click (never crossed the move threshold) and a drag that never
    // resolved a target both write nothing — that is the whole point of
    // minimal-move: no motion, no diff.
    if (commit && s.moved && s.target) {
      onReorderRef.current(s.itemId, s.target.beforeId, s.target.afterId)
    }
  }, [])

  // Abandon an in-flight drag on unmount rather than leak listeners or commit
  // against a component that is going away.
  useEffect(() => () => endSession(false), [endSession])

  const gripHandlers = useCallback(
    (itemId: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 || !vmRef.current) return
        if (sessionRef.current) endSession(false) // defensive: no overlapping drags

        const element = e.currentTarget as HTMLElement
        const rowRects = measureRowRects(element)
        const startY = e.clientY

        const onMove = (ev: PointerEvent): void => {
          const s = sessionRef.current
          const curVm = vmRef.current
          if (!s || !curVm) return
          if (!s.moved && Math.abs(ev.clientY - s.startY) < MOVE_THRESHOLD_PX) return
          s.moved = true
          const target = dropTargetFor(curVm, s.itemId, ev.clientY, s.rowRects)
          s.target = target
          setState({
            draggingId: s.itemId,
            overIndex: target ? target.index : null,
            validDrop: target !== null,
          })
        }
        const onUp = (): void => endSession(true)
        const onCancel = (): void => endSession(false)
        const onKeyDown = (ev: KeyboardEvent): void => {
          if (ev.key === 'Escape') {
            ev.preventDefault()
            endSession(false)
          }
        }

        element.setPointerCapture(e.pointerId)
        element.addEventListener('pointermove', onMove)
        element.addEventListener('pointerup', onUp)
        element.addEventListener('pointercancel', onCancel)
        window.addEventListener('keydown', onKeyDown)

        sessionRef.current = {
          itemId,
          pointerId: e.pointerId,
          startY,
          moved: false,
          rowRects,
          element,
          target: null,
          onMove,
          onUp,
          onCancel,
          onKeyDown,
        }
      },
    }),
    [endSession],
  )

  return { state, gripHandlers }
}
