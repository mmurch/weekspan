import { createWeekspan, type Item, type Weekspan } from '@weekspan/weekspan-core'
import { isVacation, nextWorkingDay, toggleVacation } from './vacation.js'

const TODAY = '2026-08-26' // Wednesday

function makeItem(id: string, marks: Item['marks'] = {}): Item {
  return { id, title: `Item ${id}`, rank: 'aV', marks }
}

function ws(items: Item[] = [], vacationDays: string[] = []): Weekspan {
  return createWeekspan({ items, vacationDays })
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

describe('toggleVacation — on/off', () => {
  it('toggling on adds the date to vacationDays', () => {
    const w = ws()
    const result = toggleVacation(w, '2026-08-25', TODAY)
    expect(result).not.toBeNull()
    expect(result!.weekspan.vacationDays).toEqual(['2026-08-25'])
  })

  it('toggling off removes the date from vacationDays', () => {
    const w = ws([], ['2026-08-25'])
    const result = toggleVacation(w, '2026-08-25', TODAY)
    expect(result).not.toBeNull()
    expect(result!.weekspan.vacationDays).toEqual([])
  })
})

describe('toggleVacation — due marks move, done/skip do not', () => {
  it('moves a due on the newly-vacation day to the next working day and reports it', () => {
    // 2026-08-25 is a Tuesday; the next working day is Wednesday 2026-08-26.
    const item = makeItem('a', { '2026-08-25': { kind: 'due' } })
    const w = ws([item])
    const result = toggleVacation(w, '2026-08-25', TODAY)!

    expect(result.movedItemIds).toEqual(['a'])
    const moved = result.weekspan.items.find((i) => i.id === 'a')!
    expect(moved.marks['2026-08-25']).toBeUndefined()
    expect(moved.marks['2026-08-26']).toEqual({ kind: 'due' })
  })

  it('does NOT move a done mark on the newly-vacation day', () => {
    const item = makeItem('a', { '2026-08-25': { kind: 'done' } })
    const w = ws([item])
    const result = toggleVacation(w, '2026-08-25', TODAY)!

    expect(result.movedItemIds).toEqual([])
    const unchanged = result.weekspan.items.find((i) => i.id === 'a')!
    expect(unchanged.marks['2026-08-25']).toEqual({ kind: 'done' })
    expect(unchanged.marks['2026-08-26']).toBeUndefined()
  })

  it('does NOT move a skip mark on the newly-vacation day', () => {
    const item = makeItem('a', { '2026-08-25': { kind: 'skip', provenance: 'deliberate' } })
    const w = ws([item])
    const result = toggleVacation(w, '2026-08-25', TODAY)!

    expect(result.movedItemIds).toEqual([])
    const unchanged = result.weekspan.items.find((i) => i.id === 'a')!
    expect(unchanged.marks['2026-08-25']).toEqual({ kind: 'skip', provenance: 'deliberate' })
  })

  it('marking a Friday vacation moves its due to the following Monday, skipping the weekend', () => {
    // 2026-08-28 is a Friday; 29/30 are Sat/Sun; the next working day is Mon 2026-08-31.
    const item = makeItem('a', { '2026-08-28': { kind: 'due' } })
    const w = ws([item])
    const result = toggleVacation(w, '2026-08-28', TODAY)!

    expect(result.movedItemIds).toEqual(['a'])
    const moved = result.weekspan.items.find((i) => i.id === 'a')!
    expect(moved.marks['2026-08-28']).toBeUndefined()
    expect(moved.marks['2026-08-31']).toEqual({ kind: 'due' })
  })

  it('shifts a due past a run of consecutive vacation days', () => {
    // 25th and 26th are already vacation; marking the 27th (Thursday) vacation
    // too must shift its due past all three onto the 28th (Friday).
    const item = makeItem('a', { '2026-08-27': { kind: 'due' } })
    const w = ws([item], ['2026-08-25', '2026-08-26'])
    const result = toggleVacation(w, '2026-08-27', TODAY)!

    expect(result.movedItemIds).toEqual(['a'])
    const moved = result.weekspan.items.find((i) => i.id === 'a')!
    expect(moved.marks['2026-08-27']).toBeUndefined()
    expect(moved.marks['2026-08-28']).toEqual({ kind: 'due' })
  })

  it('replaces an existing mark on the destination day rather than corrupting it', () => {
    // The due on the 25th should land on the 26th, which already has a done
    // mark from something else entirely — one mark per cell wins, so the
    // done is overwritten by the incoming due.
    const item = makeItem('a', {
      '2026-08-25': { kind: 'due' },
      '2026-08-26': { kind: 'done' },
    })
    const w = ws([item])
    const result = toggleVacation(w, '2026-08-25', TODAY)!

    const moved = result.weekspan.items.find((i) => i.id === 'a')!
    expect(moved.marks['2026-08-25']).toBeUndefined()
    expect(moved.marks['2026-08-26']).toEqual({ kind: 'due' })
    expect(Object.keys(moved.marks)).toEqual(['2026-08-26'])
  })
})

describe('toggleVacation — un-marking does not move anything back', () => {
  it('removing vacation status leaves marks exactly where the shift left them', () => {
    const item = makeItem('a', { '2026-08-25': { kind: 'due' } })
    const w = ws([item])
    const shifted = toggleVacation(w, '2026-08-25', TODAY)!.weekspan

    const unmarked = toggleVacation(shifted, '2026-08-25', TODAY)!
    expect(unmarked.movedItemIds).toEqual([])
    expect(unmarked.weekspan.vacationDays).toEqual([])
    const item2 = unmarked.weekspan.items.find((i) => i.id === 'a')!
    // Still on the 26th, NOT moved back to the 25th.
    expect(item2.marks['2026-08-25']).toBeUndefined()
    expect(item2.marks['2026-08-26']).toEqual({ kind: 'due' })
  })
})

describe('toggleVacation — purity', () => {
  it('never mutates the input weekspan', () => {
    const item = makeItem('a', { '2026-08-25': { kind: 'due' } })
    const w = deepFreeze(ws([item]))

    expect(() => {
      toggleVacation(w, '2026-08-25', TODAY)
      toggleVacation(w, '2026-08-28', TODAY)
    }).not.toThrow()

    expect(w.vacationDays).toEqual([])
    expect(w.items[0]!.marks).toEqual({ '2026-08-25': { kind: 'due' } })
  })
})

describe('toggleVacation — vacationDays stays sorted', () => {
  it('keeps vacationDays sorted regardless of insertion order', () => {
    let w = ws()
    w = toggleVacation(w, '2026-08-28', TODAY)!.weekspan
    w = toggleVacation(w, '2026-08-24', TODAY)!.weekspan
    w = toggleVacation(w, '2026-08-26', TODAY)!.weekspan

    expect(w.vacationDays).toEqual(['2026-08-24', '2026-08-26', '2026-08-28'])
  })
})

describe('isVacation', () => {
  it('reflects vacationDays membership', () => {
    const w = ws([], ['2026-08-25'])
    expect(isVacation(w, '2026-08-25')).toBe(true)
    expect(isVacation(w, '2026-08-26')).toBe(false)
  })
})

describe('nextWorkingDay', () => {
  it('skips weekdays already marked vacation', () => {
    const w = ws([], ['2026-08-25', '2026-08-26'])
    expect(nextWorkingDay(w, '2026-08-24')).toBe('2026-08-27')
  })

  it('skips weekends even with no vacation days at all', () => {
    const w = ws()
    expect(nextWorkingDay(w, '2026-08-28')).toBe('2026-08-31') // Fri -> Mon
  })

  it('terminates even when a whole year is marked vacation', () => {
    const vacationDays: string[] = []
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000)
      vacationDays.push(d.toISOString().slice(0, 10))
    }
    const w = ws([], vacationDays)

    let result!: string
    expect(() => {
      result = nextWorkingDay(w, '2026-01-01')
    }).not.toThrow()
    // Falls back to the literal next day rather than looping forever.
    expect(result).toBe('2026-01-02')
  })
})
