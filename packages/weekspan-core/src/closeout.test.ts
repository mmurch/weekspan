import type { Item, Weekspan, Recurrence } from './types.js'
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

function makeWeekspan(items: Item[], closedThrough: Weekspan['closedThrough']): Weekspan {
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
    const weekspan = makeWeekspan([item], null) // oldestUnclosedWeek = 2026-W34

    const result = isCloseable(weekspan, '2026-W34', TODAY)
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
    const weekspan = makeWeekspan([item], null)

    const result = isCloseable(weekspan, '2026-W34', TODAY)
    expect(result.closeable).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('a past week whose dues are skip IS closeable', () => {
    const item = makeItem('skip-item', { '2026-08-19': { kind: 'skip', provenance: 'deliberate' } })
    const weekspan = makeWeekspan([item], null)

    const result = isCloseable(weekspan, '2026-W34', TODAY)
    expect(result.closeable).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('the current week is never closeable, even when fully resolved', () => {
    const weekspan = makeWeekspan([], null)
    const result = isCloseable(weekspan, CURRENT_WEEK, TODAY)
    expect(result.closeable).toBe(false)
    expect(result.blockers).toHaveLength(0)
  })

  it('a future week is never closeable', () => {
    const weekspan = makeWeekspan([], null)
    const result = isCloseable(weekspan, addWeeks(CURRENT_WEEK, 1), TODAY)
    expect(result.closeable).toBe(false)
  })

  it('unresolvedInWeek separates explicit dues from generated occurrences', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' } // Tuesdays
    const explicitItem = makeItem('explicit', { '2026-08-19': { kind: 'due' } })
    const recurringItem = makeItem('recurring', {}, rule) // generates 2026-08-18 in W34

    const weekspan = makeWeekspan([explicitItem, recurringItem], null)
    const { explicitDues, generatedOccurrences } = unresolvedInWeek(weekspan, '2026-W34')

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
    const weekspan = makeWeekspan([], null) // oldestUnclosedWeek = 2026-W34
    expect(() => closeWeek(weekspan, '2026-W33', TODAY)).toThrow()
  })

  it('throws when the target week is not closeable', () => {
    const item = makeItem('due-item', { '2026-08-19': { kind: 'due' } })
    const weekspan = makeWeekspan([item], null) // oldest unclosed = 2026-W34, has an unresolved due
    expect(() => closeWeek(weekspan, '2026-W34', TODAY)).toThrow()
  })

  it('archives a finished item whose latest mark is in the closing week', () => {
    const item = makeItem('finished', { '2026-08-19': { kind: 'done' } }) // Wed of W34
    const weekspan = makeWeekspan([item], null) // oldest unclosed = 2026-W34

    const { weekspan: newWeekspan, archive } = closeWeek(weekspan, '2026-W34', TODAY)

    expect(newWeekspan.items).toHaveLength(0)
    expect(archive.week).toBe('2026-W34')
    expect(archive.items.map((i) => i.id)).toEqual(['finished'])
  })

  it('does NOT archive a finished item whose latest mark falls in a LATER week', () => {
    // Closing week is 2026-W33 (Mon 08-10 .. Sun 08-16). The item's only mark
    // sits in 2026-W34, strictly after the closing week's end, so it must not
    // be archived even though it reads as finished.
    const item = makeItem('later-mark', { '2026-08-19': { kind: 'done' } })
    const weekspan = makeWeekspan([item], '2026-W32') // oldest unclosed = 2026-W33

    const { weekspan: newWeekspan, archive } = closeWeek(weekspan, '2026-W33', TODAY)

    expect(archive.items).toHaveLength(0)
    expect(newWeekspan.items.map((i) => i.id)).toEqual(['later-mark'])
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
    const weekspan = makeWeekspan([item], null) // oldest unclosed = 2026-W34

    const { weekspan: newWeekspan, archive } = closeWeek(weekspan, '2026-W34', TODAY)

    expect(archive.items).toHaveLength(0)
    expect(newWeekspan.items.map((i) => i.id)).toEqual(['recurring-done'])
  })

  it('advances closedThrough and does not mutate the input weekspan', () => {
    const item = makeItem('done-item', { '2026-08-19': { kind: 'done' } })
    const weekspan = deepFreeze(makeWeekspan([item], null))

    const { weekspan: newWeekspan } = closeWeek(weekspan, '2026-W34', TODAY)

    expect(weekspan.closedThrough).toBe(null) // input untouched
    expect(weekspan.items).toHaveLength(1)
    expect(newWeekspan.closedThrough).toBe('2026-W34')
    expect(newWeekspan).not.toBe(weekspan)
  })
})

describe('autoClose', () => {
  it('over a three-month gap with one weekly recurring item, every intervening week closes with auto skips', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } // Tuesdays
    const item = makeItem('weekly', {}, rule)
    const closedThrough = addWeeks(CURRENT_WEEK, -13) // ~three months back
    const weekspan = makeWeekspan([item], closedThrough)

    // Weeks closed: closedThrough+1 .. currentWeek-1 inclusive.
    const expectedWeeksClosed = weeksBetween(closedThrough, CURRENT_WEEK) - 1

    const result = autoClose(weekspan, TODAY)

    expect(result.weeksClosed).toHaveLength(expectedWeeksClosed)
    expect(result.weeksClosed[0]).toBe(addWeeks(closedThrough, 1))
    expect(result.weeksClosed[result.weeksClosed.length - 1]).toBe(addWeeks(CURRENT_WEEK, -1))
    expect(result.weekspan.closedThrough).toBe(addWeeks(CURRENT_WEEK, -1))
    expect(result.autoSkipped).toBe(expectedWeeksClosed) // exactly one Tuesday occurrence per closed week
    expect(result.archives).toHaveLength(expectedWeeksClosed)
    // Recurring items are never archived.
    expect(result.archives.every((a) => a.items.length === 0)).toBe(true)

    const finalItem = result.weekspan.items.find((i) => i.id === 'weekly')!
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
    const weekspan = makeWeekspan([resolvedInW33, dueInW34], '2026-W32')

    const result = autoClose(weekspan, TODAY)

    expect(result.weeksClosed).toEqual(['2026-W33'])
    expect(result.weekspan.closedThrough).toBe('2026-W33')
    expect(result.autoSkipped).toBe(0)

    // The finished, non-recurring item from W33 was archived away...
    expect(result.archives).toHaveLength(1)
    expect(result.archives[0]!.items.map((i) => i.id)).toEqual(['a'])
    // ...but the blocked item stays in the working weekspan, untouched.
    expect(result.weekspan.items.map((i) => i.id)).toEqual(['b'])
    expect(result.weekspan.items[0]!.marks['2026-08-19']).toEqual({ kind: 'due' })
  })

  it('is a no-op when the weekspan is already caught up to the current week', () => {
    const weekspan = makeWeekspan([], addWeeks(CURRENT_WEEK, -1)) // oldest unclosed = current week
    const result = autoClose(weekspan, TODAY)

    expect(result.weeksClosed).toHaveLength(0)
    expect(result.archives).toHaveLength(0)
    expect(result.autoSkipped).toBe(0)
    expect(result.weekspan.closedThrough).toBe(addWeeks(CURRENT_WEEK, -1))
  })

  it('terminates when closedThrough is set far in the future rather than looping', () => {
    const weekspan = makeWeekspan([], '2099-W01')
    const result = autoClose(weekspan, TODAY)

    // window.ts clamps the left edge to the current week when closedThrough
    // is already at or beyond it, so there is nothing to auto-close.
    expect(result.weeksClosed).toHaveLength(0)
    expect(result.autoSkipped).toBe(0)
  })

  it('does not mutate the input weekspan', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' }
    const item = makeItem('weekly', {}, rule)
    const weekspan = deepFreeze(makeWeekspan([item], '2026-W33'))

    const result = autoClose(weekspan, TODAY)

    expect(weekspan.closedThrough).toBe('2026-W33')
    expect(Object.keys(weekspan.items[0]!.marks)).toHaveLength(0)
    expect(result.weekspan).not.toBe(weekspan)
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
    const weekspan = makeWeekspan([makeItem('recurring', {}, rule)], null)

    const result = isCloseable(weekspan, '2026-W34', TODAY)
    expect(result.closeable).toBe(false)
    expect(result.blockers).not.toHaveLength(0)
    expect(result.blockers.every((b) => b.kind === 'generated')).toBe(true)
  })

  it('never reports closeable:false with an empty blocker list', () => {
    const rule = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } as const
    const weekspan = makeWeekspan([makeItem('recurring', {}, rule)], null)
    for (const week of ['2026-W34', '2026-W35', '2026-W36']) {
      const r = isCloseable(weekspan, week, TODAY)
      // Past weeks must explain themselves; current/future weeks are a separate case.
      if (!r.closeable && weeksBetween(week, weekOf(TODAY)) > 0) {
        expect(r.blockers.length).toBeGreaterThan(0)
      }
    }
  })

  it('names the real reason when a recurring occurrence blocks a manual close', () => {
    const rule = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } as const
    // closedThrough W33, not null: a weekspan with no history at all now starts
    // its window at the CURRENT week (see oldestUnclosedWeek), so W34 would not
    // be the oldest unclosed week and the sequential-close guard would fire
    // first — hiding the message this test is actually about.
    const weekspan = makeWeekspan([makeItem('recurring', {}, rule)], '2026-W33')
    expect(() => closeWeek(weekspan, '2026-W34', TODAY)).toThrow(/generated due/)
  })
})

describe('vacation days and recurring occurrences', () => {
  // Tuesdays. 2026-W34 is Mon 17 Aug – Sun 23 Aug, so the rule fires Tue 18 Aug.
  const rule = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } as const
  const VACATION_TUESDAY = '2026-08-18'

  function awayOn(dates: string[], items = [makeItem('plants', {}, rule)]): Weekspan {
    return { ...makeWeekspan(items, '2026-W33'), vacationDays: dates }
  }

  it('a rule firing on a vacation day is not an unresolved occurrence', () => {
    const present = unresolvedInWeek(awayOn([]), '2026-W34')
    expect(present.generatedOccurrences.map((b) => b.date)).toEqual([VACATION_TUESDAY])

    const away = unresolvedInWeek(awayOn([VACATION_TUESDAY]), '2026-W34')
    expect(away.generatedOccurrences).toEqual([])
  })

  it('the week still closes normally — the design\'s stated rule', () => {
    expect(isCloseable(awayOn([]), '2026-W34', TODAY).closeable).toBe(false)
    expect(isCloseable(awayOn([VACATION_TUESDAY]), '2026-W34', TODAY).closeable).toBe(true)
    expect(() => closeWeek(awayOn([VACATION_TUESDAY]), '2026-W34', TODAY)).not.toThrow()
  })

  it('autoClose writes no auto-skip for a suppressed occurrence', () => {
    // The whole point of suppressing rather than materializing: a fortnight away
    // must not leave a trail of skip marks on every recurring item.
    const r = autoClose(awayOn([VACATION_TUESDAY]), TODAY)
    expect(r.autoSkipped).toBe(0)
    expect(r.weeksClosed).toContain('2026-W34')
    expect(r.weekspan.items.find((i) => i.id === 'plants')!.marks).toEqual({})
  })

  it('an EXPLICIT due on a vacation day still blocks — marking the day away does not retract it', () => {
    // Vacation suppresses SYNTHESIS only. A due the user placed by hand is real
    // backlog, and autoClose must stop on it rather than close past it. The web
    // app's `toggleVacation` shifts such a due to the next working day, so this
    // state arrives by merge, hand-edit, or the CLI — core has to be right anyway.
    const planned = makeItem('passport', { [VACATION_TUESDAY]: { kind: 'due' } })
    const weekspan = awayOn([VACATION_TUESDAY], [planned])
    const { explicitDues } = unresolvedInWeek(weekspan, '2026-W34')
    expect(explicitDues.map((b) => b.date)).toEqual([VACATION_TUESDAY])
    expect(isCloseable(weekspan, '2026-W34', TODAY).closeable).toBe(false)
    expect(autoClose(weekspan, TODAY).weeksClosed).toEqual([])
  })

  it('only the vacation date is spared; other occurrences in the week still block', () => {
    // Two weekly items: one fires on the Tuesday spent away, one on the Wednesday.
    const wednesday = { freq: 'weekly', weekday: 3, anchor: '2026-01-07' } as const
    const weekspan = awayOn([VACATION_TUESDAY], [
      makeItem('plants', {}, rule),
      makeItem('bins', {}, wednesday),
    ])
    const blockers = unresolvedInWeek(weekspan, '2026-W34').generatedOccurrences
    expect(blockers.map((b) => ({ id: b.itemId, date: b.date }))).toEqual([
      { id: 'bins', date: '2026-08-19' },
    ])

    // autoClose resolves the Wednesday and leaves the Tuesday untouched.
    const r = autoClose(weekspan, TODAY)
    expect(r.autoSkipped).toBe(1)
    const items = new Map(r.weekspan.items.map((i) => [i.id, i]))
    expect(Object.keys(items.get('bins')!.marks)).toEqual(['2026-08-19'])
    expect(items.get('plants')!.marks).toEqual({})
  })
})
