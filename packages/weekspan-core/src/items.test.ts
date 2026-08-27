import type { Item, Mark, Recurrence, Weekspan } from './types.js'
import { defaultInsertAnchor, defaultInsertBeforeId, itemsRemovedBy, removeItem } from './items.js'
import { orderItems, rankSequence } from './rank.js'

const TODAY = '2026-08-26' // Wednesday of 2026-W35 (Mon 24 Aug – Sun 30 Aug)

function ws(items: Array<Partial<Item> & { id: string }>, vacationDays: string[] = []): Weekspan {
  const ranks = rankSequence(items.length)
  return {
    version: 1,
    closedThrough: null,
    vacationDays,
    projects: [],
    items: items.map((it, i) => ({ title: it.id, rank: ranks[i]!, marks: {}, ...it })) as Item[],
  }
}

const due = (d: string): Record<string, Mark> => ({ [d]: { kind: 'due' } })
const ids = (w: Weekspan): string[] => orderItems(w.items).map((i) => i.id)

describe('removeItem', () => {
  it('removes the named item', () => {
    const w = ws([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(ids(removeItem(w, 'b')!)).toEqual(['a', 'c'])
  })

  it('takes children with it — an orphan parentId makes the file unparseable', () => {
    const w = ws([{ id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' }, { id: 'x' }])
    const next = removeItem(w, 'p')!
    expect(ids(next)).toEqual(['x'])
    for (const item of next.items) {
      if (item.parentId != null) expect(next.items.some((i) => i.id === item.parentId)).toBe(true)
    }
  })

  it('removing a child leaves the parent alone', () => {
    const w = ws([{ id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' }])
    expect(ids(removeItem(w, 'c1')!)).toEqual(['p', 'c2'])
  })

  it('returns null for an id that is not there — a delete of nothing writes nothing', () => {
    const w = ws([{ id: 'a' }])
    expect(removeItem(w, 'ghost')).toBeNull()
  })

  it('never mutates the input', () => {
    const w = ws([{ id: 'a' }, { id: 'b' }])
    const before = JSON.stringify(w)
    removeItem(w, 'a')
    expect(JSON.stringify(w)).toBe(before)
  })
})

describe('itemsRemovedBy', () => {
  it('reports the item and its children, target first', () => {
    const w = ws([{ id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' }])
    expect(itemsRemovedBy(w, 'p').map((i) => i.id)).toEqual(['p', 'c1', 'c2'])
  })

  it('is empty for an unknown id', () => {
    expect(itemsRemovedBy(ws([{ id: 'a' }]), 'ghost')).toEqual([])
  })

  it('agrees with what removeItem actually deletes', () => {
    const w = ws([{ id: 'p' }, { id: 'c', parentId: 'p' }, { id: 'x' }])
    const predicted = new Set(itemsRemovedBy(w, 'p').map((i) => i.id))
    const survivors = new Set(ids(removeItem(w, 'p')!))
    for (const id of predicted) expect(survivors.has(id)).toBe(false)
  })
})

describe('defaultInsertBeforeId', () => {
  it('names the first root with nothing marked this week', () => {
    const w = ws([
      { id: 'a', marks: due('2026-08-25') },
      { id: 'b', marks: due('2026-08-27') },
      { id: 'c' },
      { id: 'd', marks: due('2026-08-28') },
    ])
    expect(defaultInsertBeforeId(w, TODAY)).toBe('c')
  })

  it('ignores marks OUTSIDE this week', () => {
    // A due next month says nothing about this week's block.
    const w = ws([{ id: 'a', marks: due('2026-08-25') }, { id: 'b', marks: due('2026-09-20') }])
    expect(defaultInsertBeforeId(w, TODAY)).toBe('b')
  })

  it('counts a generated recurring occurrence as a marker', () => {
    const weekly: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } // Tue
    const w = ws([{ id: 'r', marks: {}, recurrence: weekly }, { id: 'plain' }])
    expect(defaultInsertBeforeId(w, TODAY)).toBe('plain')
  })

  it('a vacation day suppresses that occurrence, so the item counts as unmarked', () => {
    const weekly: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' }
    const w = ws([{ id: 'r', marks: {}, recurrence: weekly }, { id: 'plain' }], ['2026-08-25'])
    expect(defaultInsertBeforeId(w, TODAY)).toBe('r')
  })

  it('returns null when every root is marked — meaning append, not prepend', () => {
    const w = ws([{ id: 'a', marks: due('2026-08-25') }, { id: 'b', marks: due('2026-08-26') }])
    expect(defaultInsertBeforeId(w, TODAY)).toBeNull()
  })

  it('ignores children — a capture creates a root', () => {
    const w = ws([
      { id: 'p', marks: due('2026-08-25') },
      { id: 'c', parentId: 'p' }, // unmarked, but not a root
      { id: 'q', marks: due('2026-08-26') },
    ])
    expect(defaultInsertBeforeId(w, TODAY)).toBeNull()
  })

  it('is null for an empty weekspan', () => {
    expect(defaultInsertBeforeId(ws([]), TODAY)).toBeNull()
  })
})

describe('defaultInsertAnchor — both neighbours, not just one', () => {
  it('names the predecessor as well, so the item lands IN the gap', () => {
    // The bug this exists for: `insertItem` with only a beforeId has no lower
    // bound, so rankForInsert(null, anchor) produced a rank below every root and
    // the new item appeared at the very top of the list instead.
    const w = ws([
      { id: 'a', marks: due('2026-08-25') },
      { id: 'b', marks: due('2026-08-27') },
      { id: 'c' },
    ])
    expect(defaultInsertAnchor(w, TODAY)).toEqual({ beforeId: 'c', afterId: 'b' })
  })

  it('omits afterId when the gap is at the very top', () => {
    const w = ws([{ id: 'a' }, { id: 'b', marks: due('2026-08-25') }])
    expect(defaultInsertAnchor(w, TODAY)).toEqual({ beforeId: 'a' })
  })

  it('appends after the last root when everything is marked', () => {
    const w = ws([{ id: 'a', marks: due('2026-08-25') }, { id: 'b', marks: due('2026-08-26') }])
    expect(defaultInsertAnchor(w, TODAY)).toEqual({ afterId: 'b' })
  })

  it('is empty for an empty weekspan — no anchor at all', () => {
    expect(defaultInsertAnchor(ws([]), TODAY)).toEqual({})
  })

  it('never yields a key set to undefined (exactOptionalPropertyTypes)', () => {
    for (const w of [
      ws([]),
      ws([{ id: 'a' }]),
      ws([{ id: 'a', marks: due('2026-08-25') }]),
      ws([{ id: 'a', marks: due('2026-08-25') }, { id: 'b' }]),
    ]) {
      const anchor = defaultInsertAnchor(w, TODAY)
      for (const value of Object.values(anchor)) expect(value).not.toBeUndefined()
    }
  })
})
