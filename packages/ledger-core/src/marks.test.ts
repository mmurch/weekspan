import type { Item, Mark } from './types.js'
import {
  clearMark,
  getMark,
  hasMarkOfKind,
  latestMarkDate,
  markDates,
  marksInRange,
  setDone,
  setDue,
  setMark,
  setSkip,
} from './marks.js'

function makeItem(marks: Record<string, Mark> = {}): Item {
  return {
    id: 'item-1',
    title: 'Test item',
    rank: 'aV',
    marks,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('setDue / setDone / setMark — at most one mark per (item, date)', () => {
  it('setting due then done on the same date leaves exactly one mark, of kind done', () => {
    let item = makeItem()
    item = setDue(item, '2026-08-25')
    item = setDone(item, '2026-08-25')

    expect(markDates(item)).toEqual(['2026-08-25'])
    expect(getMark(item, '2026-08-25')).toEqual({ kind: 'done' })
  })

  it('setMark replaces an existing mark of a different kind', () => {
    let item = makeItem()
    item = setDone(item, '2026-08-25')
    item = setSkip(item, '2026-08-25', 'deliberate')

    expect(markDates(item)).toEqual(['2026-08-25'])
    expect(getMark(item, '2026-08-25')).toEqual({ kind: 'skip', provenance: 'deliberate' })
  })

  it('makes a non-skip mark carrying provenance unrepresentable', () => {
    const item = makeItem()
    // Mark is a discriminated union, so this is now a COMPILE error rather than
    // the runtime throw it used to be. @ts-expect-error fails the build if the
    // union is ever loosened back to an optional field.
    // @ts-expect-error provenance is not valid on a due mark
    setMark(item, '2026-08-25', { kind: 'due', provenance: 'deliberate' })
    // @ts-expect-error provenance is not valid on a done mark
    setMark(item, '2026-08-25', { kind: 'done', provenance: 'auto' })
  })

  it('requires provenance on a skip', () => {
    const item = makeItem()
    // @ts-expect-error a skip without provenance is incomplete
    setMark(item, '2026-08-25', { kind: 'skip' })
  })
})

describe('purity', () => {
  it('never mutates the input item', () => {
    const item = deepFreeze(makeItem({ '2026-08-24': { kind: 'due' } }))

    expect(() => {
      setDue(item, '2026-08-26')
      setDone(item, '2026-08-24')
      setSkip(item, '2026-08-27', 'deliberate')
      setMark(item, '2026-08-28', { kind: 'due' })
      clearMark(item, '2026-08-24')
    }).not.toThrow()

    // The frozen original is provably untouched.
    expect(item.marks).toEqual({ '2026-08-24': { kind: 'due' } })
  })

  it('setting an identical mark value returns the identical item reference', () => {
    const item = setDue(makeItem(), '2026-08-25')
    const result = setDue(item, '2026-08-25')
    expect(result).toBe(item)
  })
})

describe('clearMark', () => {
  it('on an unmarked date returns the identical reference', () => {
    const item = makeItem({ '2026-08-25': { kind: 'due' } })
    const result = clearMark(item, '2026-08-26')
    expect(result).toBe(item)
  })

  it('removes an existing mark', () => {
    const item = makeItem({ '2026-08-25': { kind: 'due' } })
    const result = clearMark(item, '2026-08-25')
    expect(result.marks).toEqual({})
    expect(getMark(result, '2026-08-25')).toBeUndefined()
  })
})

describe('setSkip provenance', () => {
  it('records provenance faithfully; both values round-trip', () => {
    const item = makeItem()

    const deliberate = setSkip(item, '2026-08-25', 'deliberate')
    expect(getMark(deliberate, '2026-08-25')).toEqual({ kind: 'skip', provenance: 'deliberate' })

    const auto = setSkip(item, '2026-08-25', 'auto')
    expect(getMark(auto, '2026-08-25')).toEqual({ kind: 'skip', provenance: 'auto' })
  })
})

describe('invalid dates', () => {
  it('throw with a useful message', () => {
    const item = makeItem()
    expect(() => getMark(item, '2026-02-30')).toThrow(/Invalid IsoDate/)
    expect(() => setDue(item, 'not-a-date')).toThrow(/Invalid IsoDate/)
    expect(() => setDone(item, '2026-13-01')).toThrow(/Invalid IsoDate/)
    expect(() => setSkip(item, '', 'deliberate')).toThrow(/Invalid IsoDate/)
    expect(() => clearMark(item, '2026-08-32')).toThrow(/Invalid IsoDate/)
    expect(() => marksInRange(item, 'bogus', '2026-08-30')).toThrow(/Invalid IsoDate/)
  })
})

describe('query helpers', () => {
  it('markDates returns all marked dates sorted ascending', () => {
    let item = makeItem()
    item = setDue(item, '2026-08-27')
    item = setDone(item, '2026-08-20')
    item = setSkip(item, '2026-08-23', 'auto')

    expect(markDates(item)).toEqual(['2026-08-20', '2026-08-23', '2026-08-27'])
  })

  it('latestMarkDate returns the last date, or undefined when unmarked', () => {
    expect(latestMarkDate(makeItem())).toBeUndefined()

    let item = makeItem()
    item = setDue(item, '2026-08-27')
    item = setDone(item, '2026-08-20')
    expect(latestMarkDate(item)).toBe('2026-08-27')
  })

  it('marksInRange is inclusive at both ends and sorted ascending', () => {
    let item = makeItem()
    item = setDue(item, '2026-08-20') // before range
    item = setDone(item, '2026-08-25') // range start, inclusive
    item = setDue(item, '2026-08-27') // middle
    item = setSkip(item, '2026-08-30', 'deliberate') // range end, inclusive
    item = setDue(item, '2026-08-31') // after range

    const result = marksInRange(item, '2026-08-25', '2026-08-30')

    expect(result.map((r) => r.date)).toEqual(['2026-08-25', '2026-08-27', '2026-08-30'])
    expect(result[0]).toEqual({ date: '2026-08-25', mark: { kind: 'done' } })
    expect(result[2]).toEqual({ date: '2026-08-30', mark: { kind: 'skip', provenance: 'deliberate' } })
  })

  it('hasMarkOfKind checks across all marked dates', () => {
    let item = makeItem()
    expect(hasMarkOfKind(item, 'skip')).toBe(false)

    item = setDue(item, '2026-08-20')
    item = setSkip(item, '2026-08-25', 'auto')

    expect(hasMarkOfKind(item, 'due')).toBe(true)
    expect(hasMarkOfKind(item, 'done')).toBe(false)
    expect(hasMarkOfKind(item, 'skip')).toBe(true)
  })
})
