import type { IsoDate, Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan, orderItems, rankSequence } from '@weekspan/weekspan-core'
import { insertItem, newItemId, updateTitle } from './draft.js'

const today: IsoDate = '2026-08-26' // Wednesday

function weekspanWith(rootTitles: string[]): Weekspan {
  const ranks = rankSequence(rootTitles.length)
  return createWeekspan({
    items: rootTitles.map((title, i) => ({
      id: `root-${i}`,
      title,
      rank: ranks[i]!,
      marks: {},
    })),
  })
}

describe('insertItem', () => {
  it('inserts between two neighbours via afterId/beforeId and orders correctly', () => {
    const w = weekspanWith(['a', 'b'])
    const { weekspan, id } = insertItem(w, { title: 'x', afterId: 'root-0', beforeId: 'root-1' })

    const order = orderItems(weekspan.items).map((i) => i.id)
    expect(order).toEqual(['root-0', id, 'root-1'])
  })

  it('inserts at the very top with only beforeId', () => {
    const w = weekspanWith(['a', 'b'])
    const { weekspan, id } = insertItem(w, { title: 'x', beforeId: 'root-0' })

    expect(orderItems(weekspan.items).map((i) => i.id)).toEqual([id, 'root-0', 'root-1'])
  })

  it('inserts at the very bottom with only afterId', () => {
    const w = weekspanWith(['a', 'b'])
    const { weekspan, id } = insertItem(w, { title: 'x', afterId: 'root-1' })

    expect(orderItems(weekspan.items).map((i) => i.id)).toEqual(['root-0', 'root-1', id])
  })

  it('inserts as a root when neither anchor nor parentId is given', () => {
    const w = weekspanWith(['a'])
    const { weekspan, id } = insertItem(w, { title: 'x' })

    const created = weekspan.items.find((i) => i.id === id)!
    expect(created.parentId ?? null).toBeNull()
  })

  it('inserts a child scoped under parentId, ranked among existing children', () => {
    const w = weekspanWith(['a'])
    const ranks = rankSequence(2)
    const withChildren: Weekspan = {
      ...w,
      items: [
        ...w.items,
        { id: 'child-0', title: 'c0', parentId: 'root-0', rank: ranks[0]!, marks: {} },
        { id: 'child-1', title: 'c1', parentId: 'root-0', rank: ranks[1]!, marks: {} },
      ],
    }

    const { weekspan, id } = insertItem(withChildren, {
      title: 'new child',
      parentId: 'root-0',
      afterId: 'child-0',
      beforeId: 'child-1',
    })

    expect(orderItems(weekspan.items).map((i) => i.id)).toEqual([
      'root-0',
      'child-0',
      id,
      'child-1',
    ])
    const created = weekspan.items.find((i) => i.id === id)!
    expect(created.parentId).toBe('root-0')
  })

  it('infers parentId from a single anchor', () => {
    const w = weekspanWith(['a'])
    const withChild: Weekspan = {
      ...w,
      items: [...w.items, { id: 'child-0', title: 'c0', parentId: 'root-0', rank: rankSequence(1)[0]!, marks: {} }],
    }
    const { weekspan, id } = insertItem(withChild, { title: 'x', afterId: 'child-0' })
    const created = weekspan.items.find((i) => i.id === id)!
    expect(created.parentId).toBe('root-0')
  })

  it('changes no other item rank when inserting between two rows', () => {
    const w = weekspanWith(['a', 'b', 'c'])
    const before = new Map(w.items.map((i) => [i.id, i.rank]))

    const { weekspan } = insertItem(w, { title: 'x', afterId: 'root-0', beforeId: 'root-1' })

    for (const item of weekspan.items) {
      if (before.has(item.id)) {
        expect(item.rank).toBe(before.get(item.id))
      }
    }
  })

  it('generates unique ids across many inserts', () => {
    let w = createWeekspan()
    const ids = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const result = insertItem(w, { title: `item ${i}` })
      expect(ids.has(result.id)).toBe(false)
      ids.add(result.id)
      w = result.weekspan
    }
    expect(ids.size).toBe(500)
  })

  it('rejects an empty title', () => {
    const w = createWeekspan()
    expect(() => insertItem(w, { title: '' })).toThrow()
  })

  it('rejects a whitespace-only title', () => {
    const w = createWeekspan()
    expect(() => insertItem(w, { title: '   \t  ' })).toThrow()
  })

  it('rejects afterId/beforeId anchors from different rank scopes', () => {
    const w = weekspanWith(['a', 'b'])
    const withChild: Weekspan = {
      ...w,
      items: [...w.items, { id: 'child-0', title: 'c0', parentId: 'root-0', rank: rankSequence(1)[0]!, marks: {} }],
    }
    // root-1 is a root item; child-0 is scoped under root-0. Different scopes.
    expect(() =>
      insertItem(withChild, { title: 'x', afterId: 'child-0', beforeId: 'root-1' }),
    ).toThrow()
  })

  it('rejects an anchor whose scope disagrees with an explicit parentId', () => {
    const w = weekspanWith(['a'])
    expect(() => insertItem(w, { title: 'x', afterId: 'root-0', parentId: 'some-other-parent' })).toThrow()
  })

  it('sets a due mark when due is provided', () => {
    const w = createWeekspan()
    const { weekspan, id } = insertItem(w, { title: 'x', due: '2026-08-27' })
    const created = weekspan.items.find((i) => i.id === id)!
    expect(created.marks['2026-08-27']).toEqual({ kind: 'due' })
  })

  it('trims the title', () => {
    const w = createWeekspan()
    const { weekspan, id } = insertItem(w, { title: '  padded title  ' })
    const created = weekspan.items.find((i) => i.id === id)!
    expect(created.title).toBe('padded title')
  })
})

describe('newItemId', () => {
  it('never collides with an existing id', () => {
    const w = createWeekspan({
      items: [{ id: 'aaaaaaa', title: 'x', rank: rankSequence(1)[0]!, marks: {} }],
    })
    for (let i = 0; i < 200; i++) {
      expect(newItemId(w)).not.toBe('aaaaaaa')
    }
  })
})

describe('updateTitle', () => {
  function weekspanWithOne(title: string): Weekspan {
    return createWeekspan({
      items: [{ id: 'item-1', title, rank: rankSequence(1)[0]!, marks: {} }],
    })
  }

  it('returns a new weekspan with the updated title', () => {
    const w = weekspanWithOne('old title')
    const next = updateTitle(w, 'item-1', 'new title')
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === 'item-1')!.title).toBe('new title')
  })

  it('returns null when the title is unchanged', () => {
    const w = weekspanWithOne('same title')
    expect(updateTitle(w, 'item-1', 'same title')).toBeNull()
  })

  it('returns null when the title is unchanged modulo surrounding whitespace', () => {
    const w = weekspanWithOne('same title')
    expect(updateTitle(w, 'item-1', '  same title  ')).toBeNull()
  })

  it('does not mutate the original weekspan', () => {
    const w = weekspanWithOne('old title')
    updateTitle(w, 'item-1', 'new title')
    expect(w.items.find((i) => i.id === 'item-1')!.title).toBe('old title')
  })

  it('rejects clearing a title to empty/whitespace', () => {
    const w = weekspanWithOne('old title')
    expect(updateTitle(w, 'item-1', '   ')).toBeNull()
    expect(w.items.find((i) => i.id === 'item-1')!.title).toBe('old title')
  })

  it('throws for an id that does not exist', () => {
    const w = weekspanWithOne('old title')
    expect(() => updateTitle(w, 'missing', 'new title')).toThrow()
  })
})

describe('projectId', () => {
  const withProject = (): Weekspan =>
    createWeekspan({
      projects: [{ id: 'work', name: 'Work', colorToken: 'barA' }],
      items: weekspanWith(['existing']).items,
    })

  it('files the new item under the given project', () => {
    // Regression: InsertOpts had no projectId, but callers spread one in.
    // TypeScript's excess-property check does not apply through a spread, so it
    // compiled and was silently discarded — quick capture showed the project
    // resolved in its preview and then created the item with none.
    const { weekspan, id } = insertItem(withProject(), { title: 'filed', projectId: 'work' })
    expect(weekspan.items.find((i) => i.id === id)!.projectId).toBe('work')
  })

  it('omits the field entirely when no project is given', () => {
    const { weekspan, id } = insertItem(withProject(), { title: 'unfiled' })
    expect(weekspan.items.find((i) => i.id === id)!.projectId).toBeUndefined()
  })
})
