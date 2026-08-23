import type { IsoDate } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { demoWeekspan } from '../grid/fixtures.js'
import { selectionFromCell } from './selection.js'
import { applyAction, resolveKey, type Action } from './keymap.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35, matches viewModel.test.ts

/**
 * A minimal stand-in for `KeyboardEvent`. This workspace's vitest config has
 * no DOM environment (no jsdom), so there is no global `KeyboardEvent`
 * constructor to call — resolveKey only reads a handful of fields off the
 * event, so a plain object satisfies it.
 */
function fakeKeyEvent(
  key: string,
  opts: { alt?: boolean; meta?: boolean; ctrl?: boolean; target?: unknown } = {},
): KeyboardEvent {
  return {
    key,
    altKey: opts.alt ?? false,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: false,
    target: opts.target ?? null,
  } as unknown as KeyboardEvent
}

describe('resolveKey — bindings', () => {
  const cases: Array<[string, boolean, Action]> = [
    ['d', false, { kind: 'setDue' }],
    ['v', false, { kind: 'setDone' }],
    ['x', false, { kind: 'clear' }],
    ['n', false, { kind: 'newItem' }],
    ['Escape', false, { kind: 'escape' }],
    ['ArrowUp', false, { kind: 'move', dir: 'up' }],
    ['ArrowDown', false, { kind: 'move', dir: 'down' }],
    ['ArrowLeft', false, { kind: 'move', dir: 'left' }],
    ['ArrowRight', false, { kind: 'move', dir: 'right' }],
    ['ArrowUp', true, { kind: 'reorder', dir: 'up' }],
    ['ArrowDown', true, { kind: 'reorder', dir: 'down' }],
    ['ArrowLeft', true, { kind: 'nudgeDue', dir: 'left' }],
    ['ArrowRight', true, { kind: 'nudgeDue', dir: 'right' }],
  ]

  for (const [key, alt, expected] of cases) {
    it(`maps ${alt ? 'Alt+' : ''}${key} to ${JSON.stringify(expected)}`, () => {
      expect(resolveKey(fakeKeyEvent(key, { alt }))).toEqual(expected)
    })
  }

  it('is case-insensitive on the mnemonic letters (Shift+D still sets due)', () => {
    expect(resolveKey(fakeKeyEvent('D'))).toEqual({ kind: 'setDue' })
  })

  it('an unbound key resolves to null', () => {
    expect(resolveKey(fakeKeyEvent('q'))).toBeNull()
  })

  it('a plain arrow key does not also fire the Alt binding', () => {
    // Sanity: pressing bare ArrowUp must not be misread as the reorder binding.
    expect(resolveKey(fakeKeyEvent('ArrowUp'))).not.toEqual({ kind: 'reorder', dir: 'up' })
  })
})

describe('resolveKey — refusals', () => {
  it('returns null when Cmd (metaKey) is held', () => {
    expect(resolveKey(fakeKeyEvent('d', { meta: true }))).toBeNull()
  })

  it('returns null when Ctrl is held', () => {
    expect(resolveKey(fakeKeyEvent('v', { ctrl: true }))).toBeNull()
  })

  it('returns null when the event target is an <input>', () => {
    const target = { tagName: 'INPUT' }
    expect(resolveKey(fakeKeyEvent('d', { target }))).toBeNull()
  })

  it('returns null when the event target is a <textarea>', () => {
    const target = { tagName: 'TEXTAREA' }
    expect(resolveKey(fakeKeyEvent('n', { target }))).toBeNull()
  })

  it('returns null when the event target is contenteditable', () => {
    const target = { tagName: 'DIV', isContentEditable: true }
    expect(resolveKey(fakeKeyEvent('x', { target }))).toBeNull()
  })

  it('a typing target does not suppress Escape or arrow navigation from working elsewhere', () => {
    // Escape and plain arrows are still resolved when the target is NOT typing —
    // this just confirms the input-refusal is target-scoped, not global.
    expect(resolveKey(fakeKeyEvent('Escape'))).toEqual({ kind: 'escape' })
  })
})

describe('applyAction — marks', () => {
  const weekspan = demoWeekspan(today)
  const sel = selectionFromCell('item-paint', today) // no pre-existing mark, not a vacation date

  it('setDue writes a due mark at the selected cell', () => {
    const result = applyAction({ kind: 'setDue' }, sel, weekspan, today)
    expect(result.weekspan).not.toBeNull()
    const item = result.weekspan!.items.find((i) => i.id === 'item-paint')!
    expect(item.marks[today]).toEqual({ kind: 'due' })
    expect(result.selection).toEqual(sel)
  })

  it('setDone writes a done mark at the selected cell', () => {
    const result = applyAction({ kind: 'setDone' }, sel, weekspan, today)
    const item = result.weekspan!.items.find((i) => i.id === 'item-paint')!
    expect(item.marks[today]).toEqual({ kind: 'done' })
  })

  it('setSkip writes a deliberate skip mark at the selected cell', () => {
    const result = applyAction({ kind: 'setSkip' }, sel, weekspan, today)
    const item = result.weekspan!.items.find((i) => i.id === 'item-paint')!
    expect(item.marks[today]).toEqual({ kind: 'skip', provenance: 'deliberate' })
  })

  it('clear removes an existing mark at the selected cell', () => {
    const withDue = applyAction({ kind: 'setDue' }, sel, weekspan, today).weekspan!
    const result = applyAction({ kind: 'clear' }, sel, withDue, today)
    const item = result.weekspan!.items.find((i) => i.id === 'item-paint')!
    expect(item.marks[today]).toBeUndefined()
  })

  it('clear on an already-unmarked cell writes nothing', () => {
    const result = applyAction({ kind: 'clear' }, sel, weekspan, today)
    expect(result.weekspan).toBeNull()
    expect(result.selection).toEqual(sel)
  })

  it('a null selection writes nothing and clears selection', () => {
    const result = applyAction({ kind: 'setDue' }, null, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: null })
  })
})

describe('applyAction — vacation days refuse due/done but allow skip/clear', () => {
  const weekspan = demoWeekspan(today)
  const vacationDate = weekspan.vacationDays[0]!
  const sel = selectionFromCell('item-paint', vacationDate)

  it('setDue is refused on a vacation day', () => {
    const result = applyAction({ kind: 'setDue' }, sel, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: sel })
  })

  it('setDone is refused on a vacation day', () => {
    const result = applyAction({ kind: 'setDone' }, sel, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: sel })
  })

  it('setSkip is allowed on a vacation day', () => {
    const result = applyAction({ kind: 'setSkip' }, sel, weekspan, today)
    expect(result.weekspan).not.toBeNull()
    const item = result.weekspan!.items.find((i) => i.id === 'item-paint')!
    expect(item.marks[vacationDate]).toEqual({ kind: 'skip', provenance: 'deliberate' })
  })

  it('clear is allowed on a vacation day', () => {
    const withSkip = applyAction({ kind: 'setSkip' }, sel, weekspan, today).weekspan!
    const result = applyAction({ kind: 'clear' }, sel, withSkip, today)
    expect(result.weekspan).not.toBeNull()
    const item = result.weekspan!.items.find((i) => i.id === 'item-paint')!
    expect(item.marks[vacationDate]).toBeUndefined()
  })
})

describe('applyAction — reorder', () => {
  const weekspan = demoWeekspan(today)

  it('reordering the topmost root item up is already in position: no write', () => {
    const sel = selectionFromCell('item-tiles', today) // topmost root by rank
    const result = applyAction({ kind: 'reorder', dir: 'up' }, sel, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: sel })
  })

  it('reordering the bottommost root item down is already in position: no write', () => {
    const sel = selectionFromCell('item-water-plants', today) // last root by rank
    const result = applyAction({ kind: 'reorder', dir: 'down' }, sel, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: sel })
  })

  it('reordering a middle item up writes a new rank that sorts it earlier', () => {
    const sel = selectionFromCell('item-roadmap', today)
    const before = weekspan.items.find((i) => i.id === 'item-roadmap')!
    const tiles = weekspan.items.find((i) => i.id === 'item-tiles')!
    const result = applyAction({ kind: 'reorder', dir: 'up' }, sel, weekspan, today)
    expect(result.weekspan).not.toBeNull()
    const after = result.weekspan!.items.find((i) => i.id === 'item-roadmap')!
    expect(after.rank).not.toBe(before.rank)
    expect(after.rank < tiles.rank).toBe(true) // now sorts ahead of the old first item
  })

  it('a null selection writes nothing', () => {
    const result = applyAction({ kind: 'reorder', dir: 'up' }, null, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: null })
  })
})

describe('applyAction — move, escape, newItem', () => {
  const weekspan = demoWeekspan(today)

  it('move never writes to the weekspan, only the selection', () => {
    const sel = selectionFromCell('item-tiles', today)
    const result = applyAction({ kind: 'move', dir: 'right' }, sel, weekspan, today)
    expect(result.weekspan).toBeNull()
    expect(result.selection).not.toBeNull()
    expect(result.selection!.itemId).toBe('item-tiles')
  })

  it('escape clears the selection and writes nothing', () => {
    const sel = selectionFromCell('item-tiles', today)
    expect(applyAction({ kind: 'escape' }, sel, weekspan, today)).toEqual({
      weekspan: null,
      selection: null,
    })
  })

  it('newItem is a no-op here (item creation is out of scope for the keymap)', () => {
    const sel = selectionFromCell('item-tiles', today)
    const result = applyAction({ kind: 'newItem' }, sel, weekspan, today)
    expect(result).toEqual({ weekspan: null, selection: sel })
  })
})
