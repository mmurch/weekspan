import type { Item, Mark, Recurrence, Weekspan } from './types.js'
import { sortByDate, sortKeyFor } from './sortByDate.js'
import { orderItems, rankSequence } from './rank.js'

const TODAY = '2026-08-26' // Wednesday of 2026-W35 (Mon 24 Aug – Sun 30 Aug)

function ws(items: Array<Partial<Item> & { id: string }>, vacationDays: string[] = []): Weekspan {
  const ranks = rankSequence(items.length)
  return {
    version: 1,
    closedThrough: null,
    vacationDays,
    projects: [],
    items: items.map((it, i) => ({
      title: it.id,
      rank: ranks[i]!,
      marks: {},
      ...it,
    })) as Item[],
  }
}

/** Ids in rendered order (roots by rank, each root's children after it). */
const order = (w: Weekspan): string[] => orderItems(w.items).map((i) => i.id)

/**
 * The order sorting PRODUCES, whether or not it had to write to get there.
 * `sortByDate` returns null when the list is already correct, so asserting on
 * its return value directly would conflate "wrong order" with "no work needed".
 */
const sortedOrder = (w: Weekspan): string[] => order(sortByDate(w, TODAY) ?? w)

const done = (d: string): Record<string, Mark> => ({ [d]: { kind: 'done' } })
const due = (d: string): Record<string, Mark> => ({ [d]: { kind: 'due' } })

describe('sortByDate — buckets', () => {
  it('puts done first, then due, then unmarked', () => {
    const w = ws([
      { id: 'nothing' },
      { id: 'due-later', marks: due('2026-08-28') },
      { id: 'done-old', marks: done('2026-08-20') },
      { id: 'due-soon', marks: due('2026-08-26') },
      { id: 'done-new', marks: done('2026-08-25') },
    ])
    expect(sortedOrder(w)).toEqual([
      'done-old',
      'done-new',
      'due-soon',
      'due-later',
      'nothing',
    ])
  })

  it('orders done items by their LATEST done mark', () => {
    const w = ws([
      { id: 'a', marks: { '2026-08-10': { kind: 'done' }, '2026-08-24': { kind: 'done' } } },
      { id: 'b', marks: done('2026-08-15') },
    ])
    // `a`'s latest is the 24th, so it sorts after `b`'s 15th — the early mark
    // on `a` must not drag it to the top.
    expect(sortedOrder(w)).toEqual(['b', 'a'])
  })

  it('orders due items by their SOONEST due mark', () => {
    const w = ws([
      { id: 'a', marks: { '2026-08-28': { kind: 'due' }, '2026-09-04': { kind: 'due' } } },
      { id: 'b', marks: due('2026-08-31') },
    ])
    expect(sortedOrder(w)).toEqual(['a', 'b'])
  })

  it('a done mark outranks a stale due on the same item', () => {
    // Matches isFinished: finishing something does not put it back on the
    // worklist because you had once planned it for a date.
    const w = ws([
      { id: 'finished', marks: { '2026-08-20': { kind: 'due' }, '2026-08-25': { kind: 'done' } } },
      { id: 'open', marks: due('2026-08-27') },
    ])
    expect(sortedOrder(w)).toEqual(['finished', 'open'])
  })

  it('leaves unmarked items in their existing relative order', () => {
    const w = ws([{ id: 'x' }, { id: 'y' }, { id: 'z' }])
    expect(sortByDate(w, TODAY)).toBeNull() // already correct
  })

  it('skip marks do not put an item in a bucket', () => {
    const w = ws([
      { id: 'skipped', marks: { '2026-08-25': { kind: 'skip', provenance: 'deliberate' } } },
      { id: 'due', marks: due('2026-08-27') },
    ])
    expect(sortedOrder(w)).toEqual(['due', 'skipped'])
  })
})

describe('sortByDate — recurring items are keyed from the current week', () => {
  // Weekly on Tuesdays. 2026-08-25 is the Tuesday of the current week.
  const weekly: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' }

  it('uses this week\'s generated occurrence as its due date', () => {
    const w = ws([
      { id: 'plain', marks: due('2026-08-27') },
      { id: 'recurring', marks: {}, recurrence: weekly },
    ])
    // The rule fires Tue the 25th, which is sooner than Thu the 27th.
    expect(sortedOrder(w)).toEqual(['recurring', 'plain'])
  })

  it('a completion this week moves it into the done bucket', () => {
    const w = ws([
      { id: 'recurring', marks: done('2026-08-25'), recurrence: weekly },
      { id: 'plain-due', marks: due('2026-08-24') },
    ])
    expect(sortedOrder(w)).toEqual(['recurring', 'plain-due'])
  })

  it('ignores marks outside the current week', () => {
    // A completion three weeks ago says nothing about a standing commitment's
    // position today; this week's occurrence is what counts.
    const w = ws([
      { id: 'recurring', marks: done('2026-08-04'), recurrence: weekly },
      { id: 'plain-done', marks: done('2026-08-24') },
    ])
    // recurring has no done THIS week, so it falls to the due bucket (Tue 25th)
    // and sorts after the genuinely-done item.
    expect(sortedOrder(w)).toEqual(['plain-done', 'recurring'])
  })

  it('a vacation day suppresses the occurrence, so it sorts as unmarked', () => {
    const w = ws(
      [{ id: 'recurring', marks: {}, recurrence: weekly }, { id: 'plain', marks: due('2026-08-28') }],
      ['2026-08-25'],
    )
    expect(sortedOrder(w)).toEqual(['plain', 'recurring'])
  })
})

describe('sortByDate — nesting', () => {
  it('sorts children within their parent and never reparents', () => {
    const w = ws([
      { id: 'root-a' },
      { id: 'child-2', parentId: 'root-a', marks: due('2026-08-29') },
      { id: 'child-1', parentId: 'root-a', marks: due('2026-08-26') },
      { id: 'root-b', marks: done('2026-08-24') },
    ])
    const sorted = sortByDate(w, TODAY)!
    // root-b (done) rises above root-a (unmarked); root-a keeps both children,
    // now in due order.
    expect(order(sorted)).toEqual(['root-b', 'root-a', 'child-1', 'child-2'])
    for (const id of ['child-1', 'child-2']) {
      expect(sorted.items.find((i) => i.id === id)!.parentId).toBe('root-a')
    }
  })

  it('a scope of one is left alone', () => {
    const w = ws([{ id: 'root' }, { id: 'only-child', parentId: 'root' }])
    expect(sortByDate(w, TODAY)).toBeNull()
  })
})

describe('sortByDate — write discipline', () => {
  it('returns null when already sorted, so a second press writes nothing', () => {
    const w = ws([
      { id: 'done', marks: done('2026-08-20') },
      { id: 'due', marks: due('2026-08-27') },
      { id: 'none' },
    ])
    expect(sortByDate(w, TODAY)).toBeNull()
  })

  it('is idempotent — sorting a sorted list is a no-op', () => {
    const w = ws([
      { id: 'none' },
      { id: 'due', marks: due('2026-08-27') },
      { id: 'done', marks: done('2026-08-20') },
    ])
    const once = sortByDate(w, TODAY)!
    expect(sortByDate(once, TODAY)).toBeNull()
  })

  it('never mutates the input', () => {
    const w = ws([{ id: 'b', marks: due('2026-08-28') }, { id: 'a', marks: done('2026-08-20') }])
    const before = JSON.stringify(w)
    sortByDate(w, TODAY)
    expect(JSON.stringify(w)).toBe(before)
  })

  it('produces valid, strictly increasing ranks', () => {
    const w = ws([
      { id: 'c' },
      { id: 'a', marks: done('2026-08-20') },
      { id: 'b', marks: due('2026-08-27') },
    ])
    const sorted = sortByDate(w, TODAY)!
    const roots = sorted.items.filter((i) => i.parentId == null)
    const ranks = orderItems(roots).map((i) => i.rank)
    expect([...ranks].sort()).toEqual(ranks)
    expect(new Set(ranks).size).toBe(ranks.length)
  })
})

describe('sortKeyFor', () => {
  it('exposes the bucket and date the order is built from', () => {
    const item: Item = { id: 'x', title: 'x', rank: 'a0', marks: done('2026-08-24') }
    expect(sortKeyFor(item, TODAY, [])).toMatchObject({ bucket: 0, date: '2026-08-24' })
  })

  it('gives unmarked items the last bucket and no date', () => {
    const item: Item = { id: 'x', title: 'x', rank: 'a0', marks: {} }
    expect(sortKeyFor(item, TODAY, [])).toMatchObject({ bucket: 2, date: '' })
  })
})
