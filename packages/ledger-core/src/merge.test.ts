import { deepEqual, isUnchanged, merge } from './merge.js'
import type { Item, Ledger, Mark } from './types.js'

function ledger(items: Item[], over: Partial<Ledger> = {}): Ledger {
  return {
    version: 1,
    closedThrough: null,
    vacationDays: [],
    projects: [],
    items,
    ...over,
  }
}

function item(id: string, over: Partial<Item> = {}): Item {
  return { id, title: id, rank: 'V', marks: {}, ...over }
}

const due: Mark = { kind: 'due' }
const done: Mark = { kind: 'done' }

/** Deep clone so mutations in a test cannot leak between base/ours/theirs. */
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

describe('deepEqual', () => {
  it('treats absent and explicitly-undefined keys as equal', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: null })).toBe(false)
  })

  it('compares nested structures and arrays', () => {
    expect(deepEqual({ m: { x: [1, 2] } }, { m: { x: [1, 2] } })).toBe(true)
    expect(deepEqual({ m: { x: [1, 2] } }, { m: { x: [2, 1] } })).toBe(false)
  })
})

describe('merge — the common single-user case', () => {
  it('takes the one side that moved, without calling it a conflict', () => {
    const base = ledger([item('a', { title: 'draft perf feedback' })])
    const ours = clone(base)
    const theirs = clone(base)
    ours.items[0]!.title = 'draft perf feedback — 4 reports'

    const r = merge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.items[0]!.title).toBe('draft perf feedback — 4 reports')
  })

  it('accepts their edit when we did not touch it', () => {
    const base = ledger([item('a', { title: 'old' })])
    const ours = clone(base)
    const theirs = clone(base)
    theirs.items[0]!.title = 'new'

    const r = merge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.items[0]!.title).toBe('new')
  })

  it('merges cell by cell — laptop marks Tuesday, phone marks Thursday', () => {
    // This is the payoff over file-level last-writer-wins: neither edit is lost,
    // even though both devices rewrote the same item in the same file.
    const base = ledger([item('a')])
    const ours = clone(base)
    const theirs = clone(base)
    ours.items[0]!.marks['2026-08-25'] = done
    theirs.items[0]!.marks['2026-08-27'] = due

    const r = merge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.items[0]!.marks).toEqual({
      '2026-08-25': done,
      '2026-08-27': due,
    })
    expect(r.stats.marksChanged).toBe(2)
  })

  it('reports a genuine same-cell conflict and resolves toward ours', () => {
    const base = ledger([item('a', { marks: { '2026-08-26': due } })])
    const ours = clone(base)
    const theirs = clone(base)
    ours.items[0]!.marks['2026-08-26'] = done
    theirs.items[0]!.marks['2026-08-26'] = { kind: 'skip', provenance: 'deliberate' }

    const r = merge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]!.field).toBe('marks.2026-08-26')
    expect(r.conflicts[0]!.resolution).toBe('ours')
    expect(r.merged.items[0]!.marks['2026-08-26']).toEqual(done)
  })

  it('merges a cell deletion against an untouched cell', () => {
    const base = ledger([item('a', { marks: { '2026-08-26': due, '2026-08-27': due } })])
    const ours = clone(base)
    const theirs = clone(base)
    delete ours.items[0]!.marks['2026-08-26']

    const r = merge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.items[0]!.marks).toEqual({ '2026-08-27': due })
  })
})

describe('merge — adds and deletes', () => {
  it('keeps items added on either side', () => {
    const base = ledger([item('a')])
    const ours = ledger([item('a'), item('b', { rank: 'k' })])
    const theirs = ledger([item('a'), item('c', { rank: 'm' })])

    const r = merge(base, ours, theirs)
    expect(r.merged.items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
    expect(r.stats.itemsAdded).toBe(2)
  })

  it('applies a deletion when the other side left it untouched', () => {
    const base = ledger([item('a'), item('b', { rank: 'k' })])
    const ours = ledger([item('a')])
    const theirs = clone(base)

    const r = merge(base, ours, theirs)
    expect(r.merged.items.map((i) => i.id)).toEqual(['a'])
    expect(r.stats.itemsRemoved).toBe(1)
  })

  it('lets an edit beat a delete, in both directions', () => {
    // Losing work silently is worse than a stray row the user can delete again.
    const base = ledger([item('a'), item('b', { rank: 'k', title: 'b' })])

    const oursEdited = ledger([item('a'), item('b', { rank: 'k', title: 'b edited' })])
    const theirsDeleted = ledger([item('a')])
    const r1 = merge(base, oursEdited, theirsDeleted)
    expect(r1.merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(r1.merged.items[1]!.title).toBe('b edited')

    const r2 = merge(base, theirsDeleted, oursEdited)
    expect(r2.merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(r2.merged.items[1]!.title).toBe('b edited')
  })

  it('marking a cell counts as an edit that beats a delete', () => {
    const base = ledger([item('a', { rank: 'k' })])
    const ours = ledger([item('a', { rank: 'k', marks: { '2026-08-26': done } })])
    const theirs = ledger([])

    const r = merge(base, ours, theirs)
    expect(r.merged.items).toHaveLength(1)
    expect(r.merged.items[0]!.marks['2026-08-26']).toEqual(done)
  })
})

describe('merge — ledger-level fields', () => {
  it('takes the later closedThrough, because close-out never reverses', () => {
    const base = ledger([], { closedThrough: '2026-W33' })
    const ours = ledger([], { closedThrough: '2026-W34' })
    const theirs = ledger([], { closedThrough: '2026-W35' })

    expect(merge(base, ours, theirs).merged.closedThrough).toBe('2026-W35')
    expect(merge(base, theirs, ours).merged.closedThrough).toBe('2026-W35')
  })

  it('treats a null closedThrough as earlier than any week', () => {
    const base = ledger([], { closedThrough: null })
    const ours = ledger([], { closedThrough: null })
    const theirs = ledger([], { closedThrough: '2026-W35' })
    expect(merge(base, ours, theirs).merged.closedThrough).toBe('2026-W35')
  })

  it('unions vacation additions but honours a removal from either side', () => {
    const base = ledger([], { vacationDays: ['2026-08-24'] })
    const ours = ledger([], { vacationDays: ['2026-08-24', '2026-08-25'] })
    const theirs = ledger([], { vacationDays: ['2026-08-26'] }) // removed the 24th

    const r = merge(base, ours, theirs)
    expect(r.merged.vacationDays).toEqual(['2026-08-25', '2026-08-26'])
  })
})

describe('merge — output shape', () => {
  it('returns items sorted by rank', () => {
    const base = ledger([])
    const ours = ledger([item('z', { rank: 'z' }), item('a', { rank: 'A' })])
    const theirs = ledger([])
    expect(merge(base, ours, theirs).merged.items.map((i) => i.id)).toEqual(['a', 'z'])
  })

  it('is idempotent — merging an already-merged state changes nothing', () => {
    const base = ledger([item('a')])
    const ours = clone(base)
    ours.items[0]!.marks['2026-08-25'] = done
    const theirs = clone(base)
    theirs.items[0]!.marks['2026-08-27'] = due

    const once = merge(base, ours, theirs).merged
    const twice = merge(once, clone(once), clone(once)).merged
    expect(twice).toEqual(once)
  })

  it('detects an untouched remote file so the caller can skip merging', () => {
    const base = ledger([item('a', { marks: { '2026-08-26': due } })])
    expect(isUnchanged(base, clone(base))).toBe(true)
    const changed = clone(base)
    changed.items[0]!.marks['2026-08-26'] = done
    expect(isUnchanged(base, changed)).toBe(false)
  })
})
