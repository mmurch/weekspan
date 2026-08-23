import type { Item, Ledger, Recurrence } from './types.js'
import { autoClose, closeWeek, isCloseable, unresolvedInWeek } from './closeout.js'
import { addWeeks, weekEnd, weekOf, weeksBetween, weekStart } from './dates.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35
const CURRENT_WEEK = '2026-W35'

function makeItem(id: string, marks: Item['marks'] = {}, recurrence?: Recurrence | null): Item {
  return {
    id,
    title: `Item ${id}`,
    rank: 'a0',
    marks,
    ...(recurrence !== undefined ? { recurrence } : {}),
  }
}

function makeLedger(items: Item[], closedThrough: Ledger['closedThrough']): Ledger {
  return {
    version: 1,
    closedThrough,
    vacationDays: [],
    projects: [],
    items,
  }
}

/** Recursively freeze so any accidental mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || Array.isArray(value))) {
    for (const key of Object.getOwnPropertyNames(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('unresolvedInWeek / isCloseable', () => {
  it('a past week with an unresolved explicit due is NOT closeable, and the blocker names the item', () => {
    // 2026-W34: Mon 2026-08-17 .. Sun 2026-08-23. Both in the past relative to TODAY.
    const item = makeItem('due-item', { '2026-08-19': { kind: 'due' } })
    const ledger = makeLedger([item], null) // oldestUnclosedWeek = 2026-W34

    const result = isCloseable(ledger, '2026-W34', TODAY)
    expect(result.closeable).toBe(false)
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0]).toEqual({
      itemId: 'due-item',
      date: '2026-08-19',
      title: 'Item due-item',
      kind: 'explicit',
    })
  })

  it('a past week whose dues are all done IS closeable', () => {
    const item = makeItem('done-item', { '2026-08-19': { kind: 'done' } })
    const ledger = makeLedger([item], null)

    const result = isCloseable(ledger, '2026-W34', TODAY)
    expect(result.closeable).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('a past week whose dues are skip IS closeable', () => {
    const item = makeItem('skip-item', { '2026-08-19': { kind: 'skip', provenance: 'deliberate' } })
    const ledger = makeLedger([item], null)

    const result = isCloseable(ledger, '2026-W34', TODAY)
    expect(result.closeable).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('the current week is never closeable, even when fully resolved', () => {
    const ledger = makeLedger([], null)
    const result = isCloseable(ledger, CURRENT_WEEK, TODAY)
    expect(result.closeable).toBe(false)
    expect(result.blockers).toHaveLength(0)
  })

  it('a future week is never closeable', () => {
    const ledger = makeLedger([], null)
    const result = isCloseable(ledger, addWeeks(CURRENT_WEEK, 1), TODAY)
    expect(result.closeable).toBe(false)
  })

  it('unresolvedInWeek separates explicit dues from generated occurrences', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' } // Tuesdays
    const explicitItem = makeItem('explicit', { '2026-08-19': { kind: 'due' } })
    const recurringItem = makeItem('recurring', {}, rule) // generates 2026-08-18 in W34

    const ledger = makeLedger([explicitItem, recurringItem], null)
    const { explicitDues, generatedOccurrences } = unresolvedInWeek(ledger, '2026-W34')

    expect(explicitDues).toEqual([
      { itemId: 'explicit', date: '2026-08-19', title: 'Item explicit', kind: 'explicit' },
    ])
    expect(generatedOccurrences).toEqual([
      { itemId: 'recurring', date: '2026-08-18', title: 'Item recurring', kind: 'generated' },
    ])
  })
})

describe('closeWeek', () => {
  it('throws when asked to close a week that is not the oldest unclosed one', () => {
    const ledger = makeLedger([], null) // oldestUnclosedWeek = 2026-W34
    expect(() => closeWeek(ledger, '2026-W33', TODAY)).toThrow()
  })

  it('throws when the target week is not closeable', () => {
    const item = makeItem('due-item', { '2026-08-19': { kind: 'due' } })
    const ledger = makeLedger([item], null) // oldest unclosed = 2026-W34, has an unresolved due
    expect(() => closeWeek(ledger, '2026-W34', TODAY)).toThrow()
  })

  it('archives a finished item whose latest mark is in the closing week', () => {
    const item = makeItem('finished', { '2026-08-19': { kind: 'done' } }) // Wed of W34
    const ledger = makeLedger([item], null) // oldest unclosed = 2026-W34

    const { ledger: newLedger, archive } = closeWeek(ledger, '2026-W34', TODAY)

    expect(newLedger.items).toHaveLength(0)
    expect(archive.week).toBe('2026-W34')
    expect(archive.items.map((i) => i.id)).toEqual(['finished'])
  })

  it('does NOT archive a finished item whose latest mark falls in a LATER week', () => {
    // Closing week is 2026-W33 (Mon 08-10 .. Sun 08-16). The item's only mark
    // sits in 2026-W34, strictly after the closing week's end, so it must not
    // be archived even though it reads as finished.
    const item = makeItem('later-mark', { '2026-08-19': { kind: 'done' } })
    const ledger = makeLedger([item], '2026-W32') // oldest unclosed = 2026-W33

    const { ledger: newLedger, archive } = closeWeek(ledger, '2026-W33', TODAY)

    expect(archive.items).toHaveLength(0)
    expect(newLedger.items.map((i) => i.id)).toEqual(['later-mark'])
  })

  it('never archives a recurring item, even one with many done marks', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-07-07' }
    const item = makeItem(
      'recurring-done',
      {
        '2026-07-07': { kind: 'done' },
        '2026-07-14': { kind: 'done' },
        '2026-07-21': { kind: 'done' },
        '2026-07-28': { kind: 'done' },
        '2026-08-04': { kind: 'done' },
        '2026-08-11': { kind: 'done' },
        '2026-08-18': { kind: 'done' }, // Tuesday of W34, resolves the closing week's occurrence
      },
      rule,
    )
    const ledger = makeLedger([item], null) // oldest unclosed = 2026-W34

    const { ledger: newLedger, archive } = closeWeek(ledger, '2026-W34', TODAY)

    expect(archive.items).toHaveLength(0)
    expect(newLedger.items.map((i) => i.id)).toEqual(['recurring-done'])
  })

  it('advances closedThrough and does not mutate the input ledger', () => {
    const item = makeItem('done-item', { '2026-08-19': { kind: 'done' } })
    const ledger = deepFreeze(makeLedger([item], null))

    const { ledger: newLedger } = closeWeek(ledger, '2026-W34', TODAY)

    expect(ledger.closedThrough).toBe(null) // input untouched
    expect(ledger.items).toHaveLength(1)
    expect(newLedger.closedThrough).toBe('2026-W34')
    expect(newLedger).not.toBe(ledger)
  })
})

describe('autoClose', () => {
  it('over a three-month gap with one weekly recurring item, every intervening week closes with auto skips', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } // Tuesdays
    const item = makeItem('weekly', {}, rule)
    const closedThrough = addWeeks(CURRENT_WEEK, -13) // ~three months back
    const ledger = makeLedger([item], closedThrough)

    // Weeks closed: closedThrough+1 .. currentWeek-1 inclusive.
    const expectedWeeksClosed = weeksBetween(closedThrough, CURRENT_WEEK) - 1

    const result = autoClose(ledger, TODAY)

    expect(result.weeksClosed).toHaveLength(expectedWeeksClosed)
    expect(result.weeksClosed[0]).toBe(addWeeks(closedThrough, 1))
    expect(result.weeksClosed[result.weeksClosed.length - 1]).toBe(addWeeks(CURRENT_WEEK, -1))
    expect(result.ledger.closedThrough).toBe(addWeeks(CURRENT_WEEK, -1))
    expect(result.autoSkipped).toBe(expectedWeeksClosed) // exactly one Tuesday occurrence per closed week
    expect(result.archives).toHaveLength(expectedWeeksClosed)
    // Recurring items are never archived.
    expect(result.archives.every((a) => a.items.length === 0)).toBe(true)

    const finalItem = result.ledger.items.find((i) => i.id === 'weekly')!
    expect(finalItem).toBeDefined()
    const skipMarks = Object.entries(finalItem.marks)
    expect(skipMarks).toHaveLength(expectedWeeksClosed)
    for (const [, mark] of skipMarks) {
      expect(mark).toEqual({ kind: 'skip', provenance: 'auto' })
    }
  })

  it('STOPS at the first week holding an unresolved explicit due, leaving it and later weeks open', () => {
    // Oldest unclosed = 2026-W33, fully resolved. 2026-W34 has an unresolved
    // explicit due and must block, leaving W34 (and the still-open W35) alone.
    const resolvedInW33 = makeItem('a', { '2026-08-12': { kind: 'done' } }) // Wed of W33
    const dueInW34 = makeItem('b', { '2026-08-19': { kind: 'due' } }) // Wed of W34
    const ledger = makeLedger([resolvedInW33, dueInW34], '2026-W32')

    const result = autoClose(ledger, TODAY)

    expect(result.weeksClosed).toEqual(['2026-W33'])
    expect(result.ledger.closedThrough).toBe('2026-W33')
    expect(result.autoSkipped).toBe(0)

    // The finished, non-recurring item from W33 was archived away...
    expect(result.archives).toHaveLength(1)
    expect(result.archives[0]!.items.map((i) => i.id)).toEqual(['a'])
    // ...but the blocked item stays in the working ledger, untouched.
    expect(result.ledger.items.map((i) => i.id)).toEqual(['b'])
    expect(result.ledger.items[0]!.marks['2026-08-19']).toEqual({ kind: 'due' })
  })

  it('is a no-op when the ledger is already caught up to the current week', () => {
    const ledger = makeLedger([], addWeeks(CURRENT_WEEK, -1)) // oldest unclosed = current week
    const result = autoClose(ledger, TODAY)

    expect(result.weeksClosed).toHaveLength(0)
    expect(result.archives).toHaveLength(0)
    expect(result.autoSkipped).toBe(0)
    expect(result.ledger.closedThrough).toBe(addWeeks(CURRENT_WEEK, -1))
  })

  it('terminates when closedThrough is set far in the future rather than looping', () => {
    const ledger = makeLedger([], '2099-W01')
    const result = autoClose(ledger, TODAY)

    // window.ts clamps the left edge to the current week when closedThrough
    // is already at or beyond it, so there is nothing to auto-close.
    expect(result.weeksClosed).toHaveLength(0)
    expect(result.autoSkipped).toBe(0)
  })

  it('does not mutate the input ledger', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' }
    const item = makeItem('weekly', {}, rule)
    const ledger = deepFreeze(makeLedger([item], '2026-W33'))

    const result = autoClose(ledger, TODAY)

    expect(ledger.closedThrough).toBe('2026-W33')
    expect(Object.keys(ledger.items[0]!.marks)).toHaveLength(0)
    expect(result.ledger).not.toBe(ledger)
  })
})

// Sanity check on the week-arithmetic assumptions the tests above lean on.
describe('test fixture sanity', () => {
  it('2026-W34 is Mon 2026-08-17 .. Sun 2026-08-23', () => {
    expect(weekStart('2026-W34')).toBe('2026-08-17')
    expect(weekEnd('2026-W34')).toBe('2026-08-23')
  })
})

describe('blocker reporting stays consistent with closeable', () => {
  it('reports the generated occurrence that blocks, rather than an empty list', () => {
    // Regression: `closeable` counted generated occurrences but `blockers` omitted
    // them, so a caller saw "cannot close, nothing is blocking" and closeWeek threw
    // "it is the current or a future week" for a week that was neither.
    const rule = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } as const
    const ledger = makeLedger([makeItem('recurring', {}, rule)], null)

    const result = isCloseable(ledger, '2026-W34', TODAY)
    expect(result.closeable).toBe(false)
    expect(result.blockers).not.toHaveLength(0)
    expect(result.blockers.every((b) => b.kind === 'generated')).toBe(true)
  })

  it('never reports closeable:false with an empty blocker list', () => {
    const rule = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } as const
    const ledger = makeLedger([makeItem('recurring', {}, rule)], null)
    for (const week of ['2026-W34', '2026-W35', '2026-W36']) {
      const r = isCloseable(ledger, week, TODAY)
      // Past weeks must explain themselves; current/future weeks are a separate case.
      if (!r.closeable && weeksBetween(week, weekOf(TODAY)) > 0) {
        expect(r.blockers.length).toBeGreaterThan(0)
      }
    }
  })

  it('names the real reason when a recurring occurrence blocks a manual close', () => {
    const rule = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } as const
    const ledger = makeLedger([makeItem('recurring', {}, rule)], null)
    expect(() => closeWeek(ledger, '2026-W34', TODAY)).toThrow(/generated due/)
  })
})
