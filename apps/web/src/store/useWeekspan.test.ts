import { createWeekspan, serialize, setDone, type Item, type Weekspan } from '@weekspan/weekspan-core'
import { MemoryStore } from './FileStore.js'

/**
 * The store seam. Every mutation in the app funnels through here, so a bug at
 * this level corrupts data from every direction at once.
 *
 * Tested through MemoryStore rather than React: the hook's contract is the
 * read/mutate/merge behaviour, and exercising it without a renderer keeps the
 * failures legible.
 */

function item(id: string, rank: string): Item {
  return { id, title: id, rank, marks: {} }
}

function ws(items: Item[]): Weekspan {
  return createWeekspan({ items })
}

describe('MemoryStore honours the FileStore contract', () => {
  it('round-trips text', async () => {
    const s = new MemoryStore(serialize(ws([item('a', 'aV')])))
    const text = await s.read()
    expect(text).not.toBeNull()
    expect(text).toContain('"a"')
  })

  it('reports unbound as null rather than throwing', async () => {
    expect(await new MemoryStore().read()).toBeNull()
  })

  it('detects an external write by content', async () => {
    const base = serialize(ws([item('a', 'aV')]))
    const s = new MemoryStore(base)
    expect(await s.hasChanged(base)).toBe(false)
    s.externalWrite(serialize(ws([item('a', 'aV'), item('b', 'am')])))
    expect(await s.hasChanged(base)).toBe(true)
  })

  it('treats identical content as unchanged even after a rewrite', async () => {
    // Byte-stable serialization is what makes this true, and it is why a no-op
    // command produces no diff in a synced folder.
    const base = serialize(ws([item('a', 'aV')]))
    const s = new MemoryStore(base)
    s.externalWrite(serialize(ws([item('a', 'aV')])))
    expect(await s.hasChanged(base)).toBe(false)
  })
})

describe('serialize/parse round-trip through the store', () => {
  it('a mutation survives a write and re-read', async () => {
    const original = ws([item('a', 'aV')])
    const s = new MemoryStore(serialize(original))

    const mutated: Weekspan = {
      ...original,
      items: [setDone(original.items[0]!, '2026-08-26')],
    }
    await s.write(serialize(mutated), serialize(original))

    const text = await s.read()
    expect(text).toContain('2026-08-26')
    expect(text).toContain('done')
  })

  it('an unchanged write leaves byte-identical content', async () => {
    const original = ws([item('a', 'aV')])
    const text = serialize(original)
    const s = new MemoryStore(text)
    await s.write(serialize(original), text)
    expect(await s.read()).toBe(text)
  })
})

describe('MemoryStore — archive contract', () => {
  // Same contract `FileSystemStore.writeArchive` must satisfy against a real
  // directory (see FileSystemStore.test.ts), so close-out logic can be
  // exercised headlessly here instead of only against a real browser.

  it('writeArchive stores the archive and returns a path-shaped string', async () => {
    const s = new MemoryStore()
    const path = await s.writeArchive({ version: 1, week: '2026-W34', items: [item('a', 'aV')] })

    expect(path).toBe('archive/2026-W34.json')
    expect(s.getArchive('2026-W34')?.items.map((i) => i.id)).toEqual(['a'])
  })

  it('refuses to overwrite an existing week', async () => {
    const s = new MemoryStore()
    await s.writeArchive({ version: 1, week: '2026-W34', items: [] })

    await expect(
      s.writeArchive({ version: 1, week: '2026-W34', items: [item('a', 'aV')] }),
    ).rejects.toThrow(/already exists/)
    // The refused write did not clobber what was already archived.
    expect(s.getArchive('2026-W34')?.items).toEqual([])
  })

  it('archiving different weeks does not collide', async () => {
    const s = new MemoryStore()
    await s.writeArchive({ version: 1, week: '2026-W33', items: [item('a', 'aV')] })
    await s.writeArchive({ version: 1, week: '2026-W34', items: [item('b', 'aW')] })

    expect(s.getArchive('2026-W33')?.items.map((i) => i.id)).toEqual(['a'])
    expect(s.getArchive('2026-W34')?.items.map((i) => i.id)).toEqual(['b'])
  })

  it('getArchive returns null for a week never archived', () => {
    expect(new MemoryStore().getArchive('2026-W01')).toBeNull()
  })
})
