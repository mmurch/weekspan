import { minimalMoveRank, type Item, type Weekspan } from '@weekspan/weekspan-core'
import type { ProjectRow } from '../grid/projectView.js'

/**
 * Dropping an item inside Project view.
 *
 * This does two things at once — sets `projectId` AND possibly `rank` — and they
 * interact. There is only ONE rank spine shared by both views, so a drop has to
 * be expressed as a global rank change even though the user is looking at a
 * grouped list.
 *
 * The rank rule is the same minimal-move rule used everywhere else: a drop is a
 * CONSTRAINT ("end up above that item"), not a coordinate. If the item's current
 * rank already satisfies it, the rank is left alone. So dragging something into a
 * project without moving it up or down changes only its project, and Priority
 * view does not silently reshuffle behind you.
 *
 * That matters because a group's items can be scattered through the global order.
 * Dropping into an empty project, or at the top of a sparse group, leaves the
 * rank genuinely underdetermined — several positions satisfy "inside this group".
 * Minimal-move resolves it by changing as little as possible.
 */

export interface ProjectDrop {
  itemId: string
  /** Group the item was dropped into. `null` is the unassigned bucket. */
  projectId: string | null
  /** Item rendered immediately above the drop, within the previewed list. */
  beforeId: string | null
  /** Item rendered immediately below the drop, within the previewed list. */
  afterId: string | null
}

/**
 * Resolve a drop against the previewed rows.
 *
 * Neighbours come from the rows the user is actually looking at, so what they
 * see is what gets committed — the same principle that fixed the earlier
 * indicator-line drag, where a separately-computed index could disagree with the
 * rendered position.
 */
export function dropFromRows(rows: readonly ProjectRow[], itemId: string): ProjectDrop | null {
  const idx = rows.findIndex((r) => r.kind === 'item' && r.row.id === itemId)
  if (idx === -1) return null

  // The owning group is the nearest divider above.
  let projectId: string | null = null
  let foundDivider = false
  for (let i = idx - 1; i >= 0; i--) {
    const r = rows[i]!
    if (r.kind === 'divider') {
      projectId = r.projectId
      foundDivider = true
      break
    }
  }
  if (!foundDivider) return null

  // Neighbours must be items in the SAME group; a neighbour across a divider
  // would express a constraint about a different part of the list.
  let beforeId: string | null = null
  for (let i = idx - 1; i >= 0; i--) {
    const r = rows[i]!
    if (r.kind === 'divider') break
    if (r.kind === 'item') { beforeId = r.row.id; break }
  }
  let afterId: string | null = null
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i]!
    if (r.kind === 'divider') break
    if (r.kind === 'item') { afterId = r.row.id; break }
  }

  return { itemId, projectId, beforeId, afterId }
}

/**
 * Apply a drop. Returns null when nothing would change — no write, no diff in a
 * synced folder.
 */
export function applyProjectDrop(weekspan: Weekspan, drop: ProjectDrop): Weekspan | null {
  const moving = weekspan.items.find((i) => i.id === drop.itemId)
  if (!moving) return null

  const currentProject = moving.projectId ?? null
  const projectChanged = currentProject !== drop.projectId

  // Validate the target exists before assigning; a dangling projectId fails the
  // strict parser on the next load, which is data corruption rather than a
  // cosmetic problem.
  if (drop.projectId !== null && !weekspan.projects.some((p) => p.id === drop.projectId)) {
    return null
  }

  const before = drop.beforeId
    ? (weekspan.items.find((i) => i.id === drop.beforeId) ?? null)
    : null
  const after = drop.afterId ? (weekspan.items.find((i) => i.id === drop.afterId) ?? null) : null
  const rank = minimalMoveRank(moving, before, after, weekspan.items)

  if (!projectChanged && rank === null) return null

  const next: Item = {
    ...moving,
    ...(projectChanged ? { projectId: drop.projectId } : {}),
    ...(rank !== null ? { rank } : {}),
  }
  return {
    ...weekspan,
    items: weekspan.items.map((i) => (i.id === moving.id ? next : i)),
  }
}
