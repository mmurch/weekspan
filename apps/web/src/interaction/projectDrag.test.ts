import { createWeekspan, orderItems, rankSequence, type Item, type Weekspan } from '@weekspan/weekspan-core'
import { buildProjectView } from '../grid/projectView.js'
import { applyProjectDrop, dropFromRows } from './projectDrag.js'

const TODAY = '2026-08-26'

function ws(): Weekspan {
  const r = rankSequence(5)
  const items: Item[] = [
    { id: 'a', title: 'a', rank: r[0]!, marks: {}, projectId: 'work' },
    { id: 'b', title: 'b', rank: r[1]!, marks: {}, projectId: 'home' },
    { id: 'c', title: 'c', rank: r[2]!, marks: {}, projectId: 'work' },
    { id: 'd', title: 'd', rank: r[3]!, marks: {} },
    { id: 'e', title: 'e', rank: r[4]!, marks: {}, projectId: 'home' },
  ]
  return createWeekspan({
    projects: [
      { id: 'work', name: 'Work', colorToken: 'barA' },
      { id: 'home', name: 'Home', colorToken: 'barB' },
      { id: 'empty', name: 'Empty', colorToken: 'barC' },
    ],
    items,
  })
}

describe('dropFromRows', () => {
  it('reads the owning group from the nearest divider above', () => {
    const vm = buildProjectView(ws(), TODAY)
    for (const row of vm.rows) {
      if (row.kind !== 'item') continue
      const drop = dropFromRows(vm.rows, row.row.id)
      expect(drop).not.toBeNull()
      const original = ws().items.find((i) => i.id === row.row.id)!
      expect(drop!.projectId).toBe(original.projectId ?? null)
    }
  })

  it('never returns a neighbour from another group', () => {
    const w = ws()
    const vm = buildProjectView(w, TODAY)
    for (const row of vm.rows) {
      if (row.kind !== 'item') continue
      const drop = dropFromRows(vm.rows, row.row.id)!
      for (const id of [drop.beforeId, drop.afterId]) {
        if (id === null) continue
        const neighbour = w.items.find((i) => i.id === id)!
        expect(neighbour.projectId ?? null).toBe(drop.projectId)
      }
    }
  })

  it('returns null for an unknown item rather than throwing into a render', () => {
    expect(dropFromRows(buildProjectView(ws(), TODAY).rows, 'nope')).toBeNull()
  })
})

describe('applyProjectDrop', () => {
  it('reassigns the project', () => {
    const w = ws()
    const next = applyProjectDrop(w, { itemId: 'd', projectId: 'work', beforeId: 'a', afterId: 'c' })
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === 'd')!.projectId).toBe('work')
  })

  it('leaves rank ALONE when the drop position does not require a change', () => {
    // The whole minimal-move point: changing project without moving up or down
    // must not silently reshuffle Priority view.
    const w = ws()
    const before = w.items.find((i) => i.id === 'd')!.rank
    const next = applyProjectDrop(w, { itemId: 'd', projectId: 'work', beforeId: 'c', afterId: null })!
    expect(next.items.find((i) => i.id === 'd')!.rank).toBe(before)
    expect(next.items.find((i) => i.id === 'd')!.projectId).toBe('work')
  })

  it('changes rank when the drop genuinely requires it', () => {
    const w = ws()
    const before = w.items.find((i) => i.id === 'e')!.rank
    const next = applyProjectDrop(w, { itemId: 'e', projectId: 'work', beforeId: null, afterId: 'a' })!
    const after = next.items.find((i) => i.id === 'e')!.rank
    expect(after).not.toBe(before)
    expect(after < w.items.find((i) => i.id === 'a')!.rank).toBe(true)
  })

  it('unassigns into the null bucket', () => {
    const next = applyProjectDrop(ws(), { itemId: 'a', projectId: null, beforeId: 'd', afterId: null })!
    expect(next.items.find((i) => i.id === 'a')!.projectId ?? null).toBeNull()
  })

  it('accepts a drop into an empty project', () => {
    const next = applyProjectDrop(ws(), { itemId: 'a', projectId: 'empty', beforeId: null, afterId: null })
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === 'a')!.projectId).toBe('empty')
  })

  it('writes nothing when neither project nor rank would change', () => {
    const w = ws()
    expect(applyProjectDrop(w, { itemId: 'a', projectId: 'work', beforeId: null, afterId: 'c' })).toBeNull()
  })

  it('refuses a drop onto a project that does not exist', () => {
    // A dangling projectId fails the strict parser on the next load — data
    // corruption, not a cosmetic problem.
    expect(applyProjectDrop(ws(), { itemId: 'a', projectId: 'ghost', beforeId: null, afterId: null })).toBeNull()
  })

  it('never mutates the input', () => {
    const w = Object.freeze(ws())
    expect(() => applyProjectDrop(w, { itemId: 'd', projectId: 'work', beforeId: 'a', afterId: 'c' })).not.toThrow()
    expect(w.items.find((i) => i.id === 'd')!.projectId).toBeUndefined()
  })

  it('keeps the global order valid after a move', () => {
    const w = ws()
    const next = applyProjectDrop(w, { itemId: 'e', projectId: 'work', beforeId: null, afterId: 'a' })!
    const ranks = orderItems(next.items).map((i) => i.rank)
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]! < ranks[i]!).toBe(true)
  })
})
