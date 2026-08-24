import type { IsoDate } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { demoWeekspan } from '../grid/fixtures.js'
import { selectionFromCell } from './selection.js'
import { applyAction } from './keymap.js'
import { intentForMouse, type MouseIntent } from './mouse.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35, matches keymap.test.ts

describe('intentForMouse — button mapping', () => {
  it('left click (button 0) maps to setDue', () => {
    expect(intentForMouse(0, 1)).toEqual({ kind: 'setDue' })
  })

  it('middle click (button 1) maps to clear', () => {
    expect(intentForMouse(1, 1)).toEqual({ kind: 'clear' })
  })

  it('right click (button 2) maps to setDone', () => {
    expect(intentForMouse(2, 1)).toEqual({ kind: 'setDone' })
  })

  it('an unmapped button (e.g. "back", button 3) returns null rather than guessing', () => {
    expect(intentForMouse(3, 1)).toBeNull()
  })

  it('another unmapped button (e.g. "forward", button 4) also returns null', () => {
    expect(intentForMouse(4, 1)).toBeNull()
  })
})

describe('intentForMouse — double click', () => {
  it('detail === 2 yields menu for the left button', () => {
    expect(intentForMouse(0, 2)).toEqual({ kind: 'menu' })
  })

  it('detail === 2 yields menu for the middle button', () => {
    expect(intentForMouse(1, 2)).toEqual({ kind: 'menu' })
  })

  it('detail === 2 yields menu for the right button, regardless of button', () => {
    expect(intentForMouse(2, 2)).toEqual({ kind: 'menu' })
  })

  it('detail === 3 (a triple click) still yields menu, not a crash or a fourth intent', () => {
    // Not a real requirement of the mapping table, but pins down that
    // anything >= 2 is treated as "double click or beyond", not just exactly 2.
    expect(intentForMouse(0, 3)).toEqual({ kind: 'menu' })
  })
})

/**
 * Applies a `MouseIntent` the same way `App.tsx` is expected to: non-`menu`
 * intents route straight through `applyAction` (`intent.kind` and
 * `Action['kind']` share their string tags on purpose — see mouse.ts's
 * module doc); `menu` never touches the weekspan.
 */
function applyIntent(
  intent: MouseIntent | null,
  sel: ReturnType<typeof selectionFromCell>,
  weekspan: ReturnType<typeof demoWeekspan>,
): { weekspan: ReturnType<typeof demoWeekspan> | null; menuOpened: boolean } {
  if (intent === null || intent.kind === 'menu') {
    return { weekspan: null, menuOpened: intent?.kind === 'menu' }
  }
  const result = applyAction({ kind: intent.kind }, sel, weekspan, today)
  return { weekspan: result.weekspan, menuOpened: false }
}

describe('intentForMouse — double-click sequence does not produce a wrong final state', () => {
  const weekspan = demoWeekspan(today)
  const sel = selectionFromCell('item-paint', today) // blank cell, not a vacation date

  it('click(detail 1), click(detail 2), dblclick(detail 2) ends DUE with the menu opened, no crash', () => {
    // Mirrors the real DOM sequence a double left-click fires. Even a caller
    // that naively wires intentForMouse to all three events (rather than
    // only `click`, per mouse.ts's recommended wiring) must not corrupt
    // state: the two detail-2 events are `menu` and never write.
    let w = weekspan

    const first = applyIntent(intentForMouse(0, 1), sel, w) // click, detail 1 -> setDue
    expect(first.menuOpened).toBe(false)
    expect(first.weekspan).not.toBeNull()
    w = first.weekspan!
    expect(w.items.find((i) => i.id === 'item-paint')!.marks[today]).toEqual({ kind: 'due' })

    const second = applyIntent(intentForMouse(0, 2), sel, w) // click, detail 2 -> menu
    expect(second.menuOpened).toBe(true)
    expect(second.weekspan).toBeNull() // menu never writes

    const third = applyIntent(intentForMouse(0, 2), sel, w) // dblclick, detail 2 -> menu
    expect(third.menuOpened).toBe(true)
    expect(third.weekspan).toBeNull()

    // Final state: DUE, written exactly once, regardless of the extra
    // detail-2 events.
    expect(w.items.find((i) => i.id === 'item-paint')!.marks[today]).toEqual({ kind: 'due' })
  })
})

describe('intentForMouse — setDue is idempotent', () => {
  it('applying setDue twice in a row leaves the cell DUE and writes nothing the second time', () => {
    const weekspan = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)

    const once = applyAction({ kind: 'setDue' }, sel, weekspan, today)
    expect(once.weekspan).not.toBeNull()
    expect(once.weekspan!.items.find((i) => i.id === 'item-paint')!.marks[today]).toEqual({
      kind: 'due',
    })

    const twice = applyAction({ kind: 'setDue' }, sel, once.weekspan!, today)
    // setDue on an already-due cell is a no-op: applyMark's "same reference"
    // contract means `weekspan: null` here, i.e. nothing to write.
    expect(twice.weekspan).toBeNull()
    expect(twice.selection).toEqual(sel)
  })

  it('a left click on an already-DUE cell leaves it DUE (absolute state, not a toggle)', () => {
    const weekspan = demoWeekspan(today)
    const sel = selectionFromCell('item-paint', today)
    const dueOnce = applyAction({ kind: 'setDue' }, sel, weekspan, today).weekspan!

    const intent = intentForMouse(0, 1) // left click
    expect(intent).toEqual({ kind: 'setDue' })
    const result = applyAction({ kind: intent!.kind as 'setDue' }, sel, dueOnce, today)

    expect(result.weekspan).toBeNull() // no-op: already due
    expect(dueOnce.items.find((i) => i.id === 'item-paint')!.marks[today]).toEqual({ kind: 'due' })
  })
})
