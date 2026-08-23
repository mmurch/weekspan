import type { Item } from './types.js'

/**
 * Fractional indexing — the single ordering spine.
 *
 * Ranks are base62 strings interpreted as fractions, NOT floats. Floats were the
 * handoff's suggestion, but they run out of precision after ~50 inserts between the
 * same two neighbours and then need a global rebalance. A rebalance rewrites every
 * item, which in a synced, git-tracked file turns one drag into a whole-file diff and
 * hands the sync provider a guaranteed conflict. String keys never need one.
 *
 * The alphabet is in ASCII order, so plain `<` on the strings IS chronological rank
 * order. Callers sort with a bare string compare and no comparator.
 *
 * INVARIANT: a key never ends in the lowest digit ('0'). If it did, no key could be
 * generated between it and its own prefix — e.g. nothing sorts between "V" and "V0".
 * Every generator here preserves that, and `assertValidRank` enforces it on input.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = ALPHABET.length

export class RankError extends Error {
  override name = 'RankError'
}

export function isValidRank(key: string): boolean {
  if (key.length === 0) return false
  if (key.endsWith('0')) return false
  for (const ch of key) if (!ALPHABET.includes(ch)) return false
  return true
}

function assertValidRank(key: string, label: string): void {
  if (!isValidRank(key)) {
    throw new RankError(`${label} is not a valid rank: ${JSON.stringify(key)}`)
  }
}

/**
 * Midpoint of two fraction strings. `b === undefined` means "positive infinity"
 * (append at the end); `a === ''` means "zero" (prepend at the start).
 */
function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined && a >= b) {
    throw new RankError(`Cannot find midpoint: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`)
  }

  if (b !== undefined) {
    // Carry any shared prefix and recurse on the remainder.
    let n = 0
    while ((a.charAt(n) || '0') === b.charAt(n)) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n) || undefined)
  }

  const digitA = a.length > 0 ? ALPHABET.indexOf(a.charAt(0)) : 0
  const digitB = b !== undefined ? ALPHABET.indexOf(b.charAt(0)) : BASE

  if (digitB - digitA > 1) {
    // Room for a digit strictly between them.
    const mid = Math.round((digitA + digitB) / 2)
    return ALPHABET.charAt(mid)
  }

  // Digits are adjacent (or equal): descend a place.
  if (b !== undefined && b.length > 1) return b.slice(0, 1)
  return ALPHABET.charAt(digitA) + midpoint(a.slice(1), undefined)
}

/**
 * A rank strictly between `prev` and `next`. Pass `null` for either end.
 *
 * This is the only way ranks should ever be produced.
 */
export function rankBetween(prev: string | null, next: string | null): string {
  if (prev !== null) assertValidRank(prev, 'prev')
  if (next !== null) assertValidRank(next, 'next')
  if (prev !== null && next !== null && prev >= next) {
    throw new RankError(
      `prev must sort before next (got ${JSON.stringify(prev)} >= ${JSON.stringify(next)})`,
    )
  }

  const result = midpoint(prev ?? '', next ?? undefined)

  // Defensive: a violated invariant here corrupts ordering silently and permanently.
  if (!isValidRank(result)) {
    throw new RankError(`Generated an invalid rank: ${JSON.stringify(result)}`)
  }
  if (prev !== null && !(prev < result)) {
    throw new RankError(`Generated rank ${JSON.stringify(result)} does not sort after prev`)
  }
  if (next !== null && !(result < next)) {
    throw new RankError(`Generated rank ${JSON.stringify(result)} does not sort before next`)
  }
  return result
}

export function initialRank(): string {
  return rankBetween(null, null)
}

/** `n` evenly spaced ranks, for seeding a fresh list. */
export function rankSequence(n: number): string[] {
  const out: string[] = []
  let prev: string | null = null
  for (let i = 0; i < n; i++) {
    const next = rankBetween(prev, null)
    out.push(next)
    prev = next
  }
  return out
}

export function byRank<T extends { rank: string }>(a: T, b: T): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0
}

/**
 * Global display order: roots by rank, each root immediately followed by its own
 * children by rank. Ranks are scoped to siblings, so a parent's children do NOT have
 * to occupy a contiguous span of the global rank space — which is the invariant that
 * a single flat spine would force us to maintain on every single move.
 *
 * Nesting is one level deep; a grandchild is a schema violation and is dropped here
 * rather than silently rendered at the wrong depth.
 */
export function orderItems(items: readonly Item[]): Item[] {
  const roots = items.filter((i) => i.parentId == null).slice().sort(byRank)
  const childrenOf = new Map<string, Item[]>()
  for (const item of items) {
    if (item.parentId == null) continue
    const siblings = childrenOf.get(item.parentId)
    if (siblings) siblings.push(item)
    else childrenOf.set(item.parentId, [item])
  }
  for (const siblings of childrenOf.values()) siblings.sort(byRank)

  const out: Item[] = []
  for (const root of roots) {
    out.push(root)
    for (const child of childrenOf.get(root.id) ?? []) out.push(child)
  }
  return out
}

/** Items sharing a rank scope (same parent), in rank order. */
export function siblingsOf(items: readonly Item[], parentId: string | null): Item[] {
  return items
    .filter((i) => (i.parentId ?? null) === parentId)
    .slice()
    .sort(byRank)
}

/**
 * Rank for a drag, moving as little as possible.
 *
 * Dropping X between A and B constrains X only to sort between them. In Project view
 * that interval usually contains many items from other projects, and the user has
 * said explicitly they do not care which one X lands beside — only that it ends up
 * "relatively higher" than what it was dropped above.
 *
 * So: if X already satisfies the constraint, write NOTHING. Otherwise move it just
 * past the boundary it violated, rather than yanking it adjacent to the target.
 * Two payoffs — repeated drags converge instead of drifting, and each drag touches
 * one line of a synced file instead of rewriting a span of it.
 *
 * Returns `null` when no write is needed.
 */
export function minimalMoveRank(
  moving: Item,
  before: Item | null,
  after: Item | null,
  allItems: readonly Item[],
): string | null {
  const lower = before?.rank ?? null // X must sort AFTER this
  const upper = after?.rank ?? null // X must sort BEFORE this

  const satisfiesLower = lower === null || moving.rank > lower
  const satisfiesUpper = upper === null || moving.rank < upper
  if (satisfiesLower && satisfiesUpper) return null

  const scope = siblingsOf(allItems, moving.parentId ?? null).filter((i) => i.id !== moving.id)

  if (!satisfiesLower && before !== null) {
    // Slide down to just after `before`.
    const idx = scope.findIndex((i) => i.id === before.id)
    const following = idx >= 0 ? scope[idx + 1] : undefined
    return rankBetween(before.rank, following?.rank ?? null)
  }

  if (!satisfiesUpper && after !== null) {
    // Slide up to just before `after`.
    const idx = scope.findIndex((i) => i.id === after.id)
    const preceding = idx > 0 ? scope[idx - 1] : undefined
    return rankBetween(preceding?.rank ?? null, after.rank)
  }

  return null
}

/**
 * Rank for inserting a brand-new item between two neighbours — the hover-seam
 * insert. Nothing else moves.
 */
export function rankForInsert(before: Item | null, after: Item | null): string {
  return rankBetween(before?.rank ?? null, after?.rank ?? null)
}
