import type { IsoDate } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { demoWeekspan } from '../grid/fixtures.js'
import { selectionFromCell } from './selection.js'
import { applyAction } from './keymap.js'
import { intentForMouse, type MouseIntent } from './mouse.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35, matches keymap.test.ts

describe('intentForMouse — button mapping', () => {
  it('left click selects, and writes nothing', () => {
    expect(intentForMouse(0, 1)).toEqual({ kind: 'select' })
  })

  it('middle click does nothing at all', () => {
    // It used to clear the cell — a destructive write on a button people press
    // by accident while scrolling.
    expect(intentForMouse(1, 1)).toBeNull()
  })

  it('right click cycles', () => {
    expect(intentForMouse(2, 1)).toEqual({ kind: 'cycle' })
  })

  it('an unmapped button (e.g. "back", button 3) returns null rather than guessing', () => {
    expect(intentForMouse(3, 1)).toBeNull()
  })

  it('another unmapped button (e.g. "forward", button 4) also returns null', () => {
    expect(intentForMouse(4, 1)).toBeNull()
  })
})

describe('intentForMouse — double click', () => {
  it('left double-click opens the menu', () => {
    expect(intentForMouse(0, 2)).toEqual({ kind: 'menu' })
    expect(intentForMouse(0, 3)).toEqual({ kind: 'menu' }) // triple, and beyond
  })

  it('RIGHT click still cycles on the second click — it is not gated on detail', () => {
    // The whole point of the cycle is clicking the same cell repeatedly. A
    // `detail >= 2` rule applied to the right button would swallow the second
    // click of every run and open the menu instead, so due -> done would be
    // unreachable by mouse.
    expect(intentForMouse(2, 2)).toEqual({ kind: 'cycle' })
    expect(intentForMouse(2, 3)).toEqual({ kind: 'cycle' })
  })

  it('middle stays inert however many times it is clicked', () => {
    expect(intentForMouse(1, 2)).toBeNull()
    expect(intentForMouse(1, 3)).toBeNull()
  })
})

/**
 * Applies a `MouseIntent` the same way `App.tsx` does: `select` and `menu` are
 * UI-only and never write; everything else routes straight through
 * `applyAction` (`intent.kind` and `Action['kind']` share their string tags on
 * purpose — see mouse.ts's module doc).
 */
function applyIntent(
  intent: MouseIntent | null,
  sel: ReturnType<typeof selectionFromCell>,
  weekspan: ReturnType<typeof demoWeekspan>,
): { weekspan: ReturnType<typeof demoWeekspan> | null; menuOpened: boolean } {
  if (intent === null || intent.kind === 'menu' || intent.kind === 'select') {
    return { weekspan: null, menuOpened: intent?.kind === 'menu' }
  }
  const result = applyAction({ kind: intent.kind }, sel, weekspan, today)
  return { weekspan: result.weekspan, menuOpened: false }
}

describe('left click is inert', () => {
  it('selects without touching the weekspan', () => {
    const weekspan = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)
    const before = JSON.stringify(weekspan)

    const result = applyIntent(intentForMouse(0, 1), sel, weekspan)
    expect(result.weekspan).toBeNull()
    expect(result.menuOpened).toBe(false)
    expect(JSON.stringify(weekspan)).toBe(before)
  })
})

describe('right click walks the cycle', () => {
  const markOf = (w: ReturnType<typeof demoWeekspan>, id: string) =>
    w.items.find((i) => i.id === id)!.marks[today]

  it('blank -> due -> done -> blank on repeated right clicks', () => {
    let w = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)
    expect(markOf(w, 'item-paint')).toBeUndefined()

    for (const expected of [{ kind: 'due' }, { kind: 'done' }]) {
      const step = applyIntent(intentForMouse(2, 1), sel, w)
      expect(step.weekspan).not.toBeNull()
      w = step.weekspan!
      expect(markOf(w, 'item-paint')).toEqual(expected)
    }

    // Third click clears it, closing the loop.
    const back = applyIntent(intentForMouse(2, 1), sel, w)
    w = back.weekspan!
    expect(markOf(w, 'item-paint')).toBeUndefined()
  })

  it('a second right click at detail 2 advances rather than opening the menu', () => {
    // The regression this mapping exists to avoid, stated end to end.
    let w = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)

    w = applyIntent(intentForMouse(2, 1), sel, w).weekspan!
    expect(markOf(w, 'item-paint')).toEqual({ kind: 'due' })

    const second = applyIntent(intentForMouse(2, 2), sel, w)
    expect(second.menuOpened).toBe(false)
    expect(markOf(second.weekspan!, 'item-paint')).toEqual({ kind: 'done' })
  })

  it('refuses to write on a vacation day, exactly as Enter does', () => {
    const base = demoWeekspan(today)
    const vacationDate = base.vacationDays[0]
    if (vacationDate === undefined) return // fixture carries one; skip if that changes
    const sel = selectionFromCell('item-paint', vacationDate)
    expect(applyIntent(intentForMouse(2, 1), sel, base).weekspan).toBeNull()
  })
})

describe('left double-click keeps the menu reachable', () => {
  it('opens the menu and never writes', () => {
    const weekspan = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)

    const result = applyIntent(intentForMouse(0, 2), sel, weekspan)
    expect(result.menuOpened).toBe(true)
    expect(result.weekspan).toBeNull()
  })

  it('the full DOM sequence of a double left-click writes nothing', () => {
    // A real double click fires click(detail 1), click(detail 2), dblclick.
    // Under the old mapping the first of those set DUE; now every step is inert.
    let w = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)
    for (const detail of [1, 2, 2]) {
      const step = applyIntent(intentForMouse(0, detail), sel, w)
      expect(step.weekspan).toBeNull()
      w = step.weekspan ?? w
    }
    expect(w.items.find((i) => i.id === 'item-paint')!.marks[today]).toBeUndefined()
  })
})
