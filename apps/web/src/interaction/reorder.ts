/**
 * The one place a row's rank is rewritten from a pair of neighbour ids.
 *
 * Extracted from `App` because two gestures now need it: the grip drag, which
 * commits it alone, and a mark drag (`markDrag.ts`), which composes it with a
 * mark move so both land in ONE weekspan and therefore one file write and one
 * undo step. A second copy of this would be a second place for the
 * `minimalMoveRank` no-op rule to drift.
 */

import type { Weekspan } from '@weekspan/weekspan-core'
import { minimalMoveRank } from '@weekspan/weekspan-core'

/**
 * Re-rank `itemId` to sit between `beforeId` and `afterId`.
 *
 * All rank maths stays in weekspan-core: the caller only ever names
 * neighbours, and `minimalMoveRank` decides whether that even requires a
 * write. A drop that already satisfies its constraint returns `null`, so a
 * dragged-and-returned row leaves no diff in a synced folder.
 */
export function reorderItem(
  weekspan: Weekspan,
  itemId: string,
  beforeId: string | null,
  afterId: string | null,
): Weekspan | null {
  const moving = weekspan.items.find((i) => i.id === itemId)
  if (!moving) return null

  const before = beforeId ? (weekspan.items.find((i) => i.id === beforeId) ?? null) : null
  const after = afterId ? (weekspan.items.find((i) => i.id === afterId) ?? null) : null

  const rank = minimalMoveRank(moving, before, after, weekspan.items)
  if (rank === null) return null

  return { ...weekspan, items: weekspan.items.map((i) => (i.id === moving.id ? { ...i, rank } : i)) }
}
