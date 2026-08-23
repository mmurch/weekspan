/**
 * Pure insert/edit logic for items — no store, no DOM, no clock.
 *
 * These are building blocks, not the `mutate(apply)` callback itself: callers
 * (the hover seam, quick capture, and the "Enter splits the stack" flow) each
 * decide when a write is warranted and wrap a call to `insertItem`/`updateTitle`
 * in their own `store.mutate(w => ...)`. Keeping that decision out of this file
 * is what lets `updateTitle` return `null` for "no change" without this module
 * knowing anything about the store's no-op-means-no-write contract.
 */

import type { IsoDate, Item, Weekspan } from '@weekspan/weekspan-core'
import { rankForInsert } from '@weekspan/weekspan-core'

export interface InsertOpts {
  title: string
  /** Id of the neighbour the new item should sort immediately AFTER. */
  afterId?: string
  /** Id of the neighbour the new item should sort immediately BEFORE. */
  beforeId?: string
  /** Rank scope for the new item. `null`/omitted means a root item. */
  parentId?: string | null
  due?: IsoDate
}

export interface InsertResult {
  weekspan: Weekspan
  id: string
}

// Base36, lowercase — short and readable in a diff, e.g. in a `git blame` of the
// ledger file. 7 characters is ~2.8e10 possibilities, which combined with the
// collision check below makes a repeat astronomically unlikely even across a
// file with thousands of items.
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 7

/** A short random id, checked against every id already in `weekspan`. */
export function newItemId(weekspan: Weekspan): string {
  const existing = new Set(weekspan.items.map((i) => i.id))
  for (;;) {
    let id = ''
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
    }
    if (!existing.has(id)) return id
  }
}

function findById(weekspan: Weekspan, id: string, label: string): Item {
  const item = weekspan.items.find((i) => i.id === id)
  if (!item) throw new Error(`insertItem: ${label} ${JSON.stringify(id)} does not exist`)
  return item
}

/**
 * Insert a brand-new item, ranked between `afterId` and `beforeId` — the
 * hover-seam and quick-capture insert. Nothing else moves: the rank is a
 * fresh midpoint (`rankForInsert`), never a rebalance, so this never rewrites
 * another item's rank.
 *
 * `afterId`/`beforeId` must resolve to items in the SAME rank scope (the same
 * `parentId`) as each other and as the resolved insertion scope, because
 * ranks are sibling-scoped — an anchor borrowed from another scope would
 * place the new item at an arbitrary position relative to its real siblings.
 * When `parentId` is omitted, the scope is inferred from whichever anchor is
 * given; when neither anchor nor `parentId` is given, the item is a new root.
 */
export function insertItem(weekspan: Weekspan, opts: InsertOpts): InsertResult {
  const title = opts.title.trim()
  if (title === '') {
    throw new Error('insertItem: title must not be empty or whitespace-only')
  }

  const afterItem = opts.afterId !== undefined ? findById(weekspan, opts.afterId, 'afterId') : null
  const beforeItem = opts.beforeId !== undefined ? findById(weekspan, opts.beforeId, 'beforeId') : null

  // Every scope-bearing input (explicit parentId, afterId's parent, beforeId's
  // parent) must agree. More than one distinct value means an anchor was
  // pulled from a different rank scope than intended.
  const scopes = new Set<string | null>()
  if (opts.parentId !== undefined) scopes.add(opts.parentId)
  if (afterItem) scopes.add(afterItem.parentId ?? null)
  if (beforeItem) scopes.add(beforeItem.parentId ?? null)
  if (scopes.size > 1) {
    throw new Error(
      'insertItem: afterId/beforeId/parentId disagree on rank scope — anchors must share the same parentId',
    )
  }
  const parentId: string | null = scopes.size > 0 ? [...scopes][0]! : null

  // rankForInsert(before, after) names its params by sort order: `before` is
  // the neighbour the result sorts after (our `afterId`), `after` is the
  // neighbour it sorts before (our `beforeId`).
  const rank = rankForInsert(afterItem, beforeItem)

  const id = newItemId(weekspan)
  const item: Item = { id, title, rank, marks: {} }
  if (parentId !== null) item.parentId = parentId
  if (opts.due !== undefined) item.marks = { [opts.due]: { kind: 'due' } }

  return {
    weekspan: { ...weekspan, items: [...weekspan.items, item] },
    id,
  }
}

/**
 * Rename an item in place. Returns `null` — no new weekspan object, so a
 * caller wiring this straight into `mutate` writes nothing — when the
 * trimmed title is unchanged, or blank (an in-place edit that clears the
 * title is rejected rather than silently producing an empty-titled item,
 * mirroring `insertItem`'s guard).
 */
export function updateTitle(weekspan: Weekspan, id: string, title: string): Weekspan | null {
  const current = findById(weekspan, id, 'id')
  const trimmed = title.trim()
  if (trimmed === '' || trimmed === current.title) return null

  return {
    ...weekspan,
    items: weekspan.items.map((i) => (i.id === id ? { ...i, title: trimmed } : i)),
  }
}
