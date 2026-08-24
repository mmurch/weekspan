import type { GridVM, RowVM } from '../grid/viewModel.js'

/**
 * Live-preview reordering.
 *
 * The earlier approach drew an insertion line from a separately-computed index.
 * Two things went wrong with that: the line rendered at the target row's top
 * edge, so it read as sitting ON a row rather than between two, and the index it
 * drew from could disagree with the neighbours the drop actually committed —
 * so the row landed somewhere other than where the line promised.
 *
 * Here the preview IS the answer. Rows are re-rendered in their prospective
 * order as the pointer moves, and the commit uses the neighbours from that same
 * previewed array. What you see is what you get, by construction.
 */

export interface RowBox {
  id: string
  top: number
  height: number
}

/**
 * A dragged root carries its children: they are ordered under their parent, so
 * moving the parent moves the group.
 */
export function groupFor(rows: readonly RowVM[], id: string): string[] {
  const idx = rows.findIndex((r) => r.id === id)
  if (idx === -1) return []
  const row = rows[idx]!
  if (row.depth === 1) return [row.id] // a child moves alone, within its siblings
  const group = [row.id]
  for (let i = idx + 1; i < rows.length && rows[i]!.depth === 1; i++) group.push(rows[i]!.id)
  return group
}

/**
 * Where the dragged group would sit, given the pointer.
 *
 * Returns an index into the array with the dragged group REMOVED, which is
 * exactly what a splice-based reinsert needs.
 */
export function previewIndexFor(
  rows: readonly RowVM[],
  boxes: readonly RowBox[],
  draggingId: string,
  pointerY: number,
): number {
  const group = new Set(groupFor(rows, draggingId))
  const others = boxes.filter((b) => !group.has(b.id))
  if (others.length === 0) return 0

  // Compare against each remaining row's midpoint: past the midpoint means the
  // dragged row belongs after it. Heights vary a lot here (a wrapping title can
  // be five lines), so midpoints must be computed per row, never assumed equal.
  let index = 0
  for (const box of others) {
    if (pointerY > box.top + box.height / 2) index++
    else break
  }
  return index
}

/**
 * The row order to RENDER mid-drag: the dragged group lifted out and reinserted
 * at `index`.
 */
export function previewRows(
  rows: readonly RowVM[],
  draggingId: string,
  index: number,
): RowVM[] {
  const group = groupFor(rows, draggingId)
  if (group.length === 0) return [...rows]
  const groupSet = new Set(group)
  const moving = rows.filter((r) => groupSet.has(r.id))
  const rest = rows.filter((r) => !groupSet.has(r.id))
  const clamped = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, clamped), ...moving, ...rest.slice(clamped)]
}

/**
 * The neighbours to commit against, read from the PREVIEWED order — the same
 * array the user is looking at.
 *
 * Constrained by scope: ranks are sibling-scoped, so a child may only land
 * between its own siblings and a root only between roots. Returning null means
 * the drop is not valid and nothing should be written.
 */
export function commitNeighbours(
  previewed: readonly RowVM[],
  draggingId: string,
): { beforeId: string | null; afterId: string | null } | null {
  const idx = previewed.findIndex((r) => r.id === draggingId)
  if (idx === -1) return null
  const row = previewed[idx]!

  if (row.depth === 0) {
    // Roots sit between roots; skip over any children in between.
    let before: string | null = null
    for (let i = idx - 1; i >= 0; i--) {
      if (previewed[i]!.depth === 0) { before = previewed[i]!.id; break }
    }
    let after: string | null = null
    for (let i = idx + 1; i < previewed.length; i++) {
      if (previewed[i]!.depth === 0) { after = previewed[i]!.id; break }
    }
    return { beforeId: before, afterId: after }
  }

  // A child's neighbours must be children of the SAME parent. Anything else
  // would move it out of its group, which this drag deliberately cannot do.
  const prev = previewed[idx - 1]
  const next = previewed[idx + 1]
  const beforeId = prev && prev.depth === 1 ? prev.id : null
  const afterId = next && next.depth === 1 ? next.id : null
  // Directly after a root: it is the first child of that root, which is valid.
  if (!prev) return null
  return { beforeId, afterId }
}

/** True when the previewed position is identical to where the row already is. */
export function isUnchanged(rows: readonly RowVM[], previewed: readonly RowVM[]): boolean {
  if (rows.length !== previewed.length) return false
  for (let i = 0; i < rows.length; i++) if (rows[i]!.id !== previewed[i]!.id) return false
  return true
}

/** Convenience for building boxes from the DOM, used by the hook. */
export function measureRows(vm: GridVM, scope: ParentNode = document): RowBox[] {
  const out: RowBox[] = []
  for (const row of vm.rows) {
    const el = scope.querySelector(`[data-row-id="${CSS.escape(row.id)}"]`)
    // Rows are display:contents and have no box of their own; .ws-title stretches
    // to the full row height, so it is the honest measurement.
    const measurable = el?.querySelector('.ws-title') ?? el?.querySelector('.ws-cell')
    if (!measurable) continue
    const r = measurable.getBoundingClientRect()
    out.push({ id: row.id, top: r.top, height: r.height })
  }
  return out
}
