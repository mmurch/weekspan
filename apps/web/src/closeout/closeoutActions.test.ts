import type { Item, Recurrence } from '@weekspan/weekspan-core'
import { createWeekspan } from '@weekspan/weekspan-core'
import { closeOutState, performAutoClose, performClose } from './closeoutActions.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35
const CURRENT_WEEK = '2026-W35'
// 2026-W34: Mon 2026-08-17 .. Sun 2026-08-23 (fully in the past relative to TODAY).
const W34 = '2026-W34'
const W33 = '2026-W33'

function makeItem(id: string, marks: Item['marks'] = {}, recurrence?: Recurrence | null): Item {
  return {
    id,
    title: `Item ${id}`,
    rank: 'a0',
    marks,
    ...(recurrence !== undefined ? { recurrence } : {}),
  }
}

describe('closeOutState', () => {
  it('reports no week to close when caught up (oldest unclosed is the current week)', () => {
    const weekspan = createWeekspan({ closedThrough: '2026-W34' }) // oldest unclosed = W35 (current)
    const state = closeOutState(weekspan, TODAY)
    expect(state).toEqual({ week: null, closeable: false, explicitBlockers: [], generatedBlockers: [] })
  })

  it('reports a closeable week with no blockers', () => {
    const item = makeItem('done-item', { '2026-08-19': { kind: 'done' } }) // Wed of W34
    const weekspan = createWeekspan({ items: [item] }) // oldest unclosed = W34
    const state = closeOutState(weekspan, TODAY)
    expect(state.week).toBe(W34)
    expect(state.closeable).toBe(true)
    expect(state.explicitBlockers).toEqual([])
    expect(state.generatedBlockers).toEqual([])
  })

  it('separates an explicit due into explicitBlockers, leaving generatedBlockers empty', () => {
    const item = makeItem('due-item', { '2026-08-19': { kind: 'due' } })
    const weekspan = createWeekspan({ items: [item] })
    const state = closeOutState(weekspan, TODAY)
    expect(state.week).toBe(W34)
    expect(state.closeable).toBe(false)
    expect(state.explicitBlockers).toHaveLength(1)
    expect(state.explicitBlockers[0]).toEqual({
      itemId: 'due-item',
      date: '2026-08-19',
      title: 'Item due-item',
      kind: 'explicit',
    })
    expect(state.generatedBlockers).toEqual([])
  })

  it('separates a lapsed recurring occurrence into generatedBlockers, leaving explicitBlockers empty', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' } // Tuesdays
    const item = makeItem('recurring', {}, rule) // generates 2026-08-18 in W34
    // closedThrough W33 so W34 is the oldest unclosed week. A ledger with no
    // explicit mark before this week now starts its window at the CURRENT week,
    // and W35 is never closeable — which would test the wrong thing entirely.
    const weekspan = createWeekspan({ items: [item], closedThrough: '2026-W33' })
    const state = closeOutState(weekspan, TODAY)
    expect(state.week).toBe(W34)
    expect(state.closeable).toBe(false)
    expect(state.explicitBlockers).toEqual([])
    expect(state.generatedBlockers).toHaveLength(1)
    expect(state.generatedBlockers[0]).toEqual({
      itemId: 'recurring',
      date: '2026-08-18',
      title: 'Item recurring',
      kind: 'generated',
    })
  })
})

describe('performClose', () => {
  it('archives a finished item, advances closedThrough, and leaves a recurring item in place', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' }
    const finished = makeItem('finished', { '2026-08-19': { kind: 'done' } }) // Wed of W34
    const recurringDone = makeItem('recurring', { '2026-08-18': { kind: 'done' } }, rule) // resolves the W34 occurrence
    const weekspan = createWeekspan({ items: [finished, recurringDone] })

    const result = performClose(weekspan, TODAY)

    expect(result).not.toBeNull()
    expect(result!.week).toBe(W34)
    expect(result!.weekspan.closedThrough).toBe(W34)
    expect(result!.archived.map((i) => i.id)).toEqual(['finished'])
    // The recurring item never archives, even though its W34 occurrence is done.
    expect(result!.weekspan.items.map((i) => i.id)).toEqual(['recurring'])
  })

  it('returns null (never throws) when the oldest unclosed week is blocked by an explicit due', () => {
    const item = makeItem('due-item', { '2026-08-19': { kind: 'due' } })
    const weekspan = createWeekspan({ items: [item] })
    expect(() => performClose(weekspan, TODAY)).not.toThrow()
    expect(performClose(weekspan, TODAY)).toBeNull()
  })

  it('returns null when there is no past week to close at all', () => {
    const weekspan = createWeekspan({ closedThrough: '2026-W34' })
    expect(performClose(weekspan, TODAY)).toBeNull()
  })
})

describe('performAutoClose', () => {
  it('over a multi-week gap, closes every past week and auto-skips lapsed occurrences with provenance "auto"', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-01-06' } // Tuesdays
    const item = makeItem('weekly', {}, rule)
    const closedThrough = '2026-W30' // ~5 weeks back from CURRENT_WEEK
    const weekspan = createWeekspan({ items: [item], closedThrough })

    const result = performAutoClose(weekspan, TODAY)

    expect(result).not.toBeNull()
    // Weeks closed: W31..W34 inclusive (everything strictly before the current week).
    expect(result!.weeksClosed).toEqual(['2026-W31', '2026-W32', '2026-W33', W34])
    expect(result!.weekspan.closedThrough).toBe(W34)
    expect(result!.autoSkipped).toBe(4) // one Tuesday occurrence per closed week
    expect(result!.archives).toHaveLength(4)
    expect(result!.archives.every((a) => a.items.length === 0)).toBe(true) // recurring items never archive

    const finalItem = result!.weekspan.items.find((i) => i.id === 'weekly')!
    const marks = Object.values(finalItem.marks)
    expect(marks).toHaveLength(4)
    for (const mark of marks) {
      expect(mark).toEqual({ kind: 'skip', provenance: 'auto' })
    }
  })

  it('stops at the first week holding an explicit due, leaving it (and the current week) open', () => {
    const resolvedInW33 = makeItem('a', { '2026-08-12': { kind: 'done' } }) // Wed of W33
    const dueInW34 = makeItem('b', { '2026-08-19': { kind: 'due' } }) // Wed of W34
    const weekspan = createWeekspan({ items: [resolvedInW33, dueInW34], closedThrough: '2026-W32' })

    const result = performAutoClose(weekspan, TODAY)

    expect(result).not.toBeNull()
    expect(result!.weeksClosed).toEqual([W33])
    expect(result!.weekspan.closedThrough).toBe(W33)
    expect(result!.autoSkipped).toBe(0)
    // The blocked item's explicit due survives untouched, and W34 stays open.
    expect(result!.weekspan.items.map((i) => i.id)).toEqual(['b'])
    expect(result!.weekspan.items[0]!.marks['2026-08-19']).toEqual({ kind: 'due' })
  })

  it('returns null on a caught-up weekspan — nothing to do, no write', () => {
    const weekspan = createWeekspan({ closedThrough: '2026-W34' }) // oldest unclosed = current week
    expect(performAutoClose(weekspan, TODAY)).toBeNull()
  })
})

// Sanity check on the week-arithmetic assumption the tests above lean on.
describe('test fixture sanity', () => {
  it('TODAY is Wednesday of 2026-W35, and 2026-W34 is the week before it', () => {
    expect(CURRENT_WEEK).toBe('2026-W35')
  })
})
