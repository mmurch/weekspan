/**
 * Indent / outdent — promoting a root to a child of its preceding root, or a
 * child back to a root. Pure, no store, no DOM — same shape as `keymap.ts`'s
 * `applyAction` helpers, which is what `{ kind: 'indent' }` / `{ kind: 'outdent' }`
 * delegate to.
 *
 * All rank arithmetic stays in `@weekspan/weekspan-core`'s `rank.ts` — this
 * module only decides WHICH parent and WHERE among its siblings; it never
 * invents a rank itself.
 */

import type { Item, Weekspan } from '@weekspan/weekspan-core'
import { orderItems, rankForInsert, siblingsOf } from '@weekspan/weekspan-core'

function findItem(weekspan: Weekspan, itemId: string): Item | undefined {
  return weekspan.items.find((i) => i.id === itemId)
}

function hasChildren(weekspan: Weekspan, itemId: string): boolean {
  return weekspan.items.some((i) => i.parentId === itemId)
}

/**
 * The nearest ROOT that sorts immediately before `itemId` in `orderItems`
 * order — the item indenting becomes this root's child. `null` if `itemId`
 * is first, or does not resolve.
 */
function precedingRoot(weekspan: Weekspan, itemId: string): Item | null {
  const ordered = orderItems(weekspan.items)
  const idx = ordered.findIndex((i) => i.id === itemId)
  if (idx <= 0) return null
  for (let j = idx - 1; j >= 0; j--) {
    if (ordered[j]!.parentId == null) return ordered[j]!
  }
  return null
}

/**
 * Whether `itemId` may be indented one level.
 *
 * Nesting is exactly one level deep (`parse` rejects a grandchild outright —
 * see weekspan-core's ITEM nesting invariant), so both directions of that
 * rule refuse here: an item that is ALREADY a child cannot be indented
 * further, and an item that already HAS CHILDREN cannot be indented either —
 * doing so would turn its children into grandchildren.
 */
export function canIndent(weekspan: Weekspan, itemId: string): boolean {
  const item = findItem(weekspan, itemId)
  if (!item) return false
  if (item.parentId != null) return false // already nested
  if (hasChildren(weekspan, itemId)) return false // would grandparent its children
  return precedingRoot(weekspan, itemId) !== null
}

/** Whether `itemId` may be outdented — i.e. is currently a child. */
export function canOutdent(weekspan: Weekspan, itemId: string): boolean {
  const item = findItem(weekspan, itemId)
  return item != null && item.parentId != null
}

/**
 * Make `itemId` a child of the nearest preceding root, ranked LAST among that
 * root's existing children — ranks are sibling-scoped, so keeping the item's
 * old (root-scope) rank would place it at an arbitrary position among its new
 * siblings.
 *
 * Returns null (never throws) when refused: no preceding root (item is
 * first), the item is already nested, or the item has children of its own.
 */
export function indentItem(weekspan: Weekspan, itemId: string): Weekspan | null {
  if (!canIndent(weekspan, itemId)) return null

  const newParent = precedingRoot(weekspan, itemId)!

  const newSiblings = siblingsOf(weekspan.items, newParent.id)
  const lastSibling = newSiblings[newSiblings.length - 1] ?? null
  const rank = rankForInsert(lastSibling, null)

  return {
    ...weekspan,
    items: weekspan.items.map((i) =>
      i.id === itemId ? { ...i, parentId: newParent.id, rank } : i,
    ),
  }
}

/**
 * Make `itemId` a root again, ranked immediately after its former parent —
 * so it lands right where it was nested rather than jumping to the top or
 * bottom of the root list.
 *
 * Returns null (never throws) when `itemId` is not currently a child.
 */
export function outdentItem(weekspan: Weekspan, itemId: string): Weekspan | null {
  if (!canOutdent(weekspan, itemId)) return null

  const item = findItem(weekspan, itemId)!
  const formerParentId = item.parentId!
  const formerParent = findItem(weekspan, formerParentId)
  if (!formerParent) return null // dangling parentId; refuse rather than guess

  const roots = siblingsOf(weekspan.items, null)
  const parentIdx = roots.findIndex((r) => r.id === formerParentId)
  const nextRoot = parentIdx >= 0 ? (roots[parentIdx + 1] ?? null) : null
  const rank = rankForInsert(formerParent, nextRoot)

  return {
    ...weekspan,
    items: weekspan.items.map((i) => {
      if (i.id !== itemId) return i
      const next = { ...i, rank }
      delete next.parentId
      return next
    }),
  }
}
