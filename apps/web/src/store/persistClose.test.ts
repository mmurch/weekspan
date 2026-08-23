import { createWeekspan, serialize, type Item, type Weekspan } from '@weekspan/weekspan-core'
import { MemoryStore } from './FileStore.js'
import { persistAutoClose, persistClose } from './persistClose.js'

/**
 * Exercises the ORDER MATTERS guarantee against `MemoryStore` — archive(s)
 * before the trimmed weekspan — the same ordering
 * `packages/cli/src/commands/closeout.ts` uses and for the same reason: an
 * orphaned archive is recoverable, a trimmed weekspan with no archive is not.
 */

function item(id: string, rank: string): Item {
  return { id, title: id, rank, marks: {} }
}

function ws(items: Item[]): Weekspan {
  return createWeekspan({ items })
}

describe('persistClose', () => {
  it('archives, then writes the trimmed weekspan', async () => {
    const before = ws([item('a', 'aV')])
    const store = new MemoryStore(serialize(before))
    const after = ws([])

    await persistClose(store, serialize(before), { weekspan: after, archived: [item('a', 'aV')], week: '2026-W34' })

    expect(store.getArchive('2026-W34')?.items.map((i) => i.id)).toEqual(['a'])
    expect(await store.read()).toBe(serialize(after))
  })

  it('ORDER MATTERS: when the archive write refuses (week already archived), the weekspan is never touched', async () => {
    const before = ws([item('a', 'aV')])
    const store = new MemoryStore(serialize(before))
    await store.writeArchive({ version: 1, week: '2026-W34', items: [] }) // pre-existing archive, will collide

    await expect(
      persistClose(store, serialize(before), { weekspan: ws([]), archived: [item('a', 'aV')], week: '2026-W34' }),
    ).rejects.toThrow(/already exists/)

    expect(await store.read()).toBe(serialize(before)) // the trim was never written
  })
})

describe('persistAutoClose', () => {
  it('writes every archive, then one weekspan write', async () => {
    const before = ws([item('a', 'aV'), item('b', 'aW')])
    const store = new MemoryStore(serialize(before))
    const after = ws([])

    await persistAutoClose(store, serialize(before), {
      weekspan: after,
      archives: [
        { version: 1, week: '2026-W33', items: [item('a', 'aV')] },
        { version: 1, week: '2026-W34', items: [item('b', 'aW')] },
      ],
    })

    expect(store.getArchive('2026-W33')?.items.map((i) => i.id)).toEqual(['a'])
    expect(store.getArchive('2026-W34')?.items.map((i) => i.id)).toEqual(['b'])
    expect(await store.read()).toBe(serialize(after))
  })

  it('ORDER MATTERS: if any archive write refuses, the weekspan is never touched', async () => {
    const before = ws([item('a', 'aV'), item('b', 'aW')])
    const store = new MemoryStore(serialize(before))
    await store.writeArchive({ version: 1, week: '2026-W34', items: [] }) // pre-existing, collides below

    await expect(
      persistAutoClose(store, serialize(before), {
        weekspan: ws([]),
        archives: [
          { version: 1, week: '2026-W33', items: [item('a', 'aV')] },
          { version: 1, week: '2026-W34', items: [item('b', 'aW')] }, // collides
        ],
      }),
    ).rejects.toThrow(/already exists/)

    // W33 did get archived (partial progress is fine — it's the recoverable
    // "orphaned archive" case) but the weekspan write never happened.
    expect(store.getArchive('2026-W33')?.items.map((i) => i.id)).toEqual(['a'])
    expect(await store.read()).toBe(serialize(before))
  })
})
