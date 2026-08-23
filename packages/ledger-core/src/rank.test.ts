import {
  RankError,
  byRank,
  initialRank,
  isValidRank,
  minimalMoveRank,
  orderItems,
  rankBetween,
  rankForInsert,
  rankSequence,
  siblingsOf,
} from './rank.js'
import type { Item } from './types.js'

function item(id: string, rank: string, parentId: string | null = null): Item {
  return { id, title: id, rank, parentId, marks: {} }
}

describe('rankBetween', () => {
  it('produces a key between two bounds', () => {
    const a = rankBetween(null, null)
    const b = rankBetween(a, null)
    const mid = rankBetween(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('produces ascending keys when appending', () => {
    const keys = rankSequence(50)
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1]! < keys[i]!).toBe(true)
    }
  })

  it('produces descending keys when prepending', () => {
    const keys: string[] = [initialRank()]
    for (let i = 0; i < 50; i++) keys.unshift(rankBetween(null, keys[0]!))
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1]! < keys[i]!).toBe(true)
    }
  })

  it('never needs a rebalance — 500 inserts between the same two neighbours', () => {
    // This is the whole reason ranks are strings and not floats. Floats lose
    // precision after ~50 midpoints here and force a global renumber.
    let lo = initialRank()
    const hi = rankBetween(lo, null)
    for (let i = 0; i < 500; i++) {
      const mid = rankBetween(lo, hi)
      expect(lo < mid).toBe(true)
      expect(mid < hi).toBe(true)
      lo = mid
    }
  })

  it('keeps every generated key valid', () => {
    let prev: string | null = null
    for (let i = 0; i < 200; i++) {
      const next: string = rankBetween(prev, null)
      expect(isValidRank(next)).toBe(true)
      expect(next.endsWith('0')).toBe(false)
      prev = next
    }
  })

  it('rejects reversed or equal bounds', () => {
    const a = initialRank()
    const b = rankBetween(a, null)
    expect(() => rankBetween(b, a)).toThrow(RankError)
    expect(() => rankBetween(a, a)).toThrow(RankError)
  })

  it('rejects malformed input ranks', () => {
    expect(() => rankBetween('V0', null)).toThrow(RankError) // trailing zero
    expect(() => rankBetween('', null)).toThrow(RankError)
    expect(() => rankBetween('V!', null)).toThrow(RankError)
  })
})

describe('orderItems', () => {
  it('places each child directly after its parent, both in rank order', () => {
    const [r1, r2, r3] = rankSequence(3) as [string, string, string]
    const [c1, c2] = rankSequence(2) as [string, string]
    const items = [
      item('b', r2),
      item('b-child2', c2, 'b'),
      item('a', r1),
      item('c', r3),
      item('b-child1', c1, 'b'),
    ]
    expect(orderItems(items).map((i) => i.id)).toEqual(['a', 'b', 'b-child1', 'b-child2', 'c'])
  })

  it('drops grandchildren rather than rendering them at the wrong depth', () => {
    const [r1] = rankSequence(1) as [string]
    const items = [item('a', r1), item('a-c', r1, 'a'), item('a-c-c', r1, 'a-c')]
    expect(orderItems(items).map((i) => i.id)).toEqual(['a', 'a-c'])
  })

  it('sorts by rank, not by array position', () => {
    const [r1, r2] = rankSequence(2) as [string, string]
    expect(orderItems([item('second', r2), item('first', r1)]).map((i) => i.id)).toEqual([
      'first',
      'second',
    ])
  })
})

describe('minimalMoveRank', () => {
  // Global order: a b c d e. Suppose b and e share a project, and the user drags
  // e above b in Project view.
  function fixture() {
    const [ra, rb, rc, rd, re] = rankSequence(5) as [string, string, string, string, string]
    return {
      a: item('a', ra),
      b: item('b', rb),
      c: item('c', rc),
      d: item('d', rd),
      e: item('e', re),
    }
  }

  it('writes nothing when the constraint is already satisfied', () => {
    const { a, b, c, d, e } = fixture()
    const all = [a, b, c, d, e]
    // b is already between a and c globally; dropping it there changes nothing.
    expect(minimalMoveRank(b, a, c, all)).toBeNull()
  })

  it('writes nothing when a project-view drag does not change project-local order', () => {
    const { a, b, c, d, e } = fixture()
    const all = [a, b, c, d, e]
    // b and e are in one project; b is already above e. Re-dropping b above e is a no-op.
    expect(minimalMoveRank(b, null, e, all)).toBeNull()
  })

  it('moves up just past the boundary it violated, not adjacent to the target', () => {
    const { a, b, c, d, e } = fixture()
    const all = [a, b, c, d, e]
    // Drag e above b. e must end up sorting before b — but it need not land next to it.
    const moved = minimalMoveRank(e, null, b, all)
    expect(moved).not.toBeNull()
    expect(moved! < b.rank).toBe(true)
    // Minimal move: it slid just past b, so it stays after a rather than jumping to top.
    expect(a.rank < moved!).toBe(true)
  })

  it('moves down just past the boundary it violated', () => {
    const { a, b, c, d, e } = fixture()
    const all = [a, b, c, d, e]
    // Drag a below d.
    const moved = minimalMoveRank(a, d, null, all)
    expect(moved).not.toBeNull()
    expect(moved! > d.rank).toBe(true)
    expect(moved! < e.rank).toBe(true)
  })

  it('converges — repeating the same drag stops writing', () => {
    const { a, b, c, d, e } = fixture()
    let all = [a, b, c, d, e]
    const first = minimalMoveRank(e, null, b, all)
    expect(first).not.toBeNull()
    const movedE = { ...e, rank: first! }
    all = [a, b, c, d, movedE]
    // Second identical drag must be a no-op; otherwise ranks drift on every drag.
    expect(minimalMoveRank(movedE, null, b, all)).toBeNull()
  })

  it('can lift an item to the top of its scope', () => {
    const { a, b, c, d, e } = fixture()
    const all = [a, b, c, d, e]
    const moved = minimalMoveRank(e, null, a, all)
    expect(moved).not.toBeNull()
    expect(moved! < a.rank).toBe(true)
  })
})

describe('siblingsOf', () => {
  it('scopes to one parent and sorts by rank', () => {
    const [r1, r2] = rankSequence(2) as [string, string]
    const items = [item('p', r1), item('c2', r2, 'p'), item('c1', r1, 'p')]
    expect(siblingsOf(items, 'p').map((i) => i.id)).toEqual(['c1', 'c2'])
    expect(siblingsOf(items, null).map((i) => i.id)).toEqual(['p'])
  })
})

describe('rankForInsert', () => {
  it('inserts between neighbours without disturbing them', () => {
    const [r1, r2] = rankSequence(2) as [string, string]
    const a = item('a', r1)
    const b = item('b', r2)
    const inserted = rankForInsert(a, b)
    expect(a.rank < inserted).toBe(true)
    expect(inserted < b.rank).toBe(true)
    expect([a, b].map((i) => i.rank)).toEqual([r1, r2]) // untouched
  })
})

describe('byRank', () => {
  it('sorts ascending', () => {
    const [r1, r2, r3] = rankSequence(3) as [string, string, string]
    const sorted = [{ rank: r3 }, { rank: r1 }, { rank: r2 }].sort(byRank)
    expect(sorted.map((x) => x.rank)).toEqual([r1, r2, r3])
  })
})
