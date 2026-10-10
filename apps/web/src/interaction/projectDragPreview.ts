import type { ProjectRow } from '../grid/projectView.js'

/**
 * Live-preview reordering for PROJECT view.
 *
 * `dragPreview.ts` previews a flat `RowVM[]`. Project view renders a
 * `ProjectRow[]` — the same rows interleaved with group dividers — and those
 * dividers are load-bearing, not decoration: `dropFromRows` reads an item's
 * group from the nearest divider ABOVE it. So the preview has to move the
 * dragged row through a list that contains dividers, and the index space has
 * to include them. A slot immediately after a divider is what "first item of
 * this group" means, and it is the only way to drop into a group that is
 * currently empty.
 *
 * This module is the missing half of `projectDrag.ts`. `dropFromRows` was
 * always written to resolve a drop against the PREVIEWED rows ("what you see
 * is what commits"); until now nothing produced a previewed project list, so
 * it was handed the committed one and every drop resolved to the item's own
 * current neighbours — a guaranteed no-op.
 *
 * Positions, not ids, are the identity here. Item ids come from the file and
 * a divider's key is a project id (or the empty bucket), so a shared id
 * namespace would be a collision waiting to happen. Every function below
 * indexes into the `ProjectRow[]` it was given.
 */

/**
 * DOM key for a divider. The unassigned bucket has `projectId: null`, which
 * needs a stable non-empty string to survive a `data-` attribute round trip.
 */
export const NO_PROJECT_KEY = '__none__'

export function dividerKey(projectId: string | null): string {
  return projectId ?? NO_PROJECT_KEY
}

/** A measured project row, identified by its position in the list. */
export interface ProjectRowBox {
  index: number
  top: number
  height: number
}

/**
 * Row indices the drag carries: the item itself plus, for a root, the child
 * rows immediately beneath it. Same rule as `groupFor` in `dragPreview.ts` —
 * children are ordered under their parent, so moving a parent moves the group.
 * A child moves alone.
 *
 * The walk stops at a divider as well as at the next root, since a child can
 * never belong to a group its parent is not in.
 */
export function projectGroupFor(rows: readonly ProjectRow[], itemId: string): number[] {
  const idx = rows.findIndex((r) => r.kind === 'item' && r.row.id === itemId)
  if (idx === -1) return []
  const row = rows[idx]!
  if (row.kind !== 'item') return []
  if (row.row.depth === 1) return [idx]

  const group = [idx]
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i]!
    if (r.kind !== 'item' || r.row.depth !== 1) break
    group.push(i)
  }
  return group
}

/**
 * Measure every project row, dividers included.
 *
 * Rows are `display: contents` and have no box of their own, so an item is
 * measured through `.ws-title` exactly as `measureRows` does. A divider IS a
 * real element, so it measures directly.
 */
export function measureProjectRows(
  rows: readonly ProjectRow[],
  scope: ParentNode = document,
): ProjectRowBox[] {
  const out: ProjectRowBox[] = []
  rows.forEach((row, index) => {
    const el =
      row.kind === 'divider'
        ? scope.querySelector(`[data-divider-key="${CSS.escape(dividerKey(row.projectId))}"]`)
        : scope.querySelector(`[data-row-id="${CSS.escape(row.row.id)}"]`)
    if (!el) return
    const measurable =
      row.kind === 'divider'
        ? el
        : (el.querySelector('.ws-title') ?? el.querySelector('.ws-cell'))
    if (!measurable) return
    const r = measurable.getBoundingClientRect()
    out.push({ index, top: r.top, height: r.height })
  })
  return out
}

/**
 * Lowest index a dragged row may be reinserted at.
 *
 * Never above the first divider: `dropFromRows` resolves an item's group by
 * scanning UP for a divider and returns null when there isn't one, so a row
 * parked above the first group header is un-droppable. Clamping here keeps the
 * preview honest — the row visibly refuses to go somewhere it could not commit,
 * instead of following the cursor up and then silently doing nothing on release.
 */
function minIndex(rest: readonly ProjectRow[]): number {
  const first = rest.findIndex((r) => r.kind === 'divider')
  return first === -1 ? rest.length : first + 1
}

/**
 * Where the dragged group would sit, as an index into the list with that group
 * REMOVED — which is what a splice-based reinsert needs.
 *
 * Midpoints are computed per row because heights vary a lot (a wrapping title
 * can be five lines, a divider is short), so an assumed uniform height would
 * drift badly down a long list.
 */
export function previewProjectIndexFor(
  rows: readonly ProjectRow[],
  boxes: readonly ProjectRowBox[],
  draggingId: string,
  pointerY: number,
): number {
  const group = new Set(projectGroupFor(rows, draggingId))
  const others = boxes.filter((b) => !group.has(b.index))
  const rest = rows.filter((_, i) => !group.has(i))
  const floor = minIndex(rest)
  if (others.length === 0) return floor

  let index = 0
  for (const box of others) {
    if (pointerY > box.top + box.height / 2) index++
    else break
  }
  return Math.max(floor, Math.min(index, rest.length))
}

/**
 * The project-row order to RENDER mid-drag: the dragged group lifted out and
 * reinserted at `index`.
 *
 * `index` is into the list with the dragged group ALREADY REMOVED — the same
 * space `previewProjectIndexFor` returns, and the space a splice-based reinsert
 * needs. Computing it against the full list is off by one whenever the dragged
 * row sits above the target.
 *
 * Dividers never move — they stay in `rest` at their
 * own positions, so the group headers hold still while a row travels between
 * them.
 */
export function previewProjectRows(
  rows: readonly ProjectRow[],
  draggingId: string,
  index: number,
): ProjectRow[] {
  const group = projectGroupFor(rows, draggingId)
  if (group.length === 0) return [...rows]
  const groupSet = new Set(group)
  const moving = rows.filter((_, i) => groupSet.has(i))
  const rest = rows.filter((_, i) => !groupSet.has(i))
  const clamped = Math.max(minIndex(rest), Math.min(index, rest.length))
  return [...rest.slice(0, clamped), ...moving, ...rest.slice(clamped)]
}

/**
 * True when the previewed list is identical to the committed one — same rows,
 * same order, and crucially each item under the same divider. A drag that ends
 * where it started must write nothing, so a synced folder sees no diff for a
 * gesture that changed nothing.
 */
export function isProjectUnchanged(
  rows: readonly ProjectRow[],
  previewed: readonly ProjectRow[],
): boolean {
  if (rows.length !== previewed.length) return false
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!
    const b = previewed[i]!
    if (a.kind !== b.kind) return false
    if (a.kind === 'divider' && b.kind === 'divider') {
      if (a.projectId !== b.projectId) return false
    } else if (a.kind === 'item' && b.kind === 'item') {
      if (a.row.id !== b.row.id) return false
    }
  }
  return true
}
