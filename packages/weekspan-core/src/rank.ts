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
 * Rank for inserting a brand-new item between two neighbours — the hover-seam,
 * quick-capture and CLI insert. Nothing else moves.
 *
 * `scope` is the sibling list the new item joins, and it is REQUIRED, because a
 * missing anchor is a QUESTION, not an answer. `after === null` does not mean
 * "above everything"; it means the caller did not name an upper bound, and the
 * real bound is whichever sibling actually follows `before`.
 *
 * Reading a null anchor as infinity is what minted duplicate ranks.
 * `midpoint(a, undefined)` is deterministic, so any two callers appending after
 * the same key get the same key back. Project view made that reachable: the
 * seam at the end of a project GROUP passes no upper bound, but a group is not
 * a rank scope — items from other groups sort above it. Two groups appending at
 * their own ends therefore walked the same sequence of keys and collided term
 * for term, producing items that shared a rank. The file still parsed and
 * rendered; it broke only later, when an insert between the colliding pair
 * asked `rankBetween` for a key between X and X.
 *
 * `minimalMoveRank` has always resolved its neighbours from the scope this way,
 * which is why dragging never produced a duplicate. Inserts now do the same.
 *
 * Resolution is by rank COMPARISON, never by array position, so a caller that
 * hands over an unsorted scope (or one that still contains a duplicate) gets a
 * usable answer rather than a surprise.
 */
export function rankForInsert(
  before: Item | null,
  after: Item | null,
  scope: readonly Item[],
): string {
  const sorted = [...scope].sort(byRank)

  let lower = before
  let upper = after

  if (lower === null && upper === null) {
    // No anchors at all: append at the true end of the scope. This is the ONE
    // case where an unbounded `rankBetween(x, null)` is sound, because `x` is
    // the scope maximum by construction.
    lower = sorted[sorted.length - 1] ?? null
  } else if (upper === null) {
    // Strictly greater, so `lower` itself is skipped — and so is anything
    // already sharing its rank.
    upper = sorted.find((i) => i.rank > lower!.rank) ?? null
  } else if (lower === null) {
    for (const i of sorted) {
      if (i.rank >= upper.rank) break
      lower = i
    }
  }

  return rankBetween(lower?.rank ?? null, upper?.rank ?? null)
}

/** One item's rank rewritten by `repairDuplicateRanks`. */
export interface RankRepair {
  id: string
  from: string
  to: string
}

/**
 * Give every item a rank that sorts strictly after its predecessor's, within
 * its own sibling scope. Returns the items unchanged (and an empty `repairs`)
 * when nothing collides, so a caller can use `repairs.length` to decide whether
 * a write is warranted at all.
 *
 * Duplicate ranks are RECOVERABLE, not fatal, which is why this exists instead
 * of a `parse` rejection. A collision costs you an ordering that was already
 * ambiguous; refusing to open the file costs you the whole ledger. Rejecting
 * would also have punished the user for a bug the app itself committed — the
 * files that need this were written by `rankForInsert`'s old unbounded append,
 * not by hand.
 *
 * The repair keeps the FIRST item of a colliding run where it is and moves the
 * later ones up into the gap above, so what you see does not jump.
 *
 * "First" means first in the order given, and the sort below is relied on to be
 * STABLE (required of `Array.prototype.sort` since ES2019) so that a colliding
 * pair keeps it. That is what makes the repair both display-preserving and
 * reproducible: callers repair a freshly parsed file, `parse` preserves the
 * order the items appear in on disk, so two devices repairing the same file
 * independently compute the same ranks and the fix does not become a conflict.
 * An `id` tie-break would also be reproducible, but it would reorder the two
 * rows on screen for no reason the user could see.
 */
export function repairDuplicateRanks(items: readonly Item[]): {
  items: Item[]
  repairs: RankRepair[]
} {
  const repairs: RankRepair[] = []
  const fresh = new Map<string, string>()

  const scopes = new Map<string | null, Item[]>()
  for (const item of items) {
    const key = item.parentId ?? null
    const list = scopes.get(key)
    if (list) list.push(item)
    else scopes.set(key, [item])
  }

  for (const scope of scopes.values()) {
    const sorted = [...scope].sort(byRank)

    let prev: string | null = null
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i]!
      if (prev === null || item.rank > prev) {
        prev = item.rank
        continue
      }

      // The next rank that is genuinely above `prev` — skipping the rest of the
      // colliding run, which is about to be re-ranked into this same gap.
      let next: string | null = null
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j]!.rank > prev) {
          next = sorted[j]!.rank
          break
        }
      }

      const rank = rankBetween(prev, next)
      repairs.push({ id: item.id, from: item.rank, to: rank })
      fresh.set(item.id, rank)
      prev = rank
    }
  }

  if (repairs.length === 0) return { items: [...items], repairs }
  return {
    items: items.map((i) => {
      const rank = fresh.get(i.id)
      return rank === undefined ? i : { ...i, rank }
    }),
    repairs,
  }
}
