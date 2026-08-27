import type { IsoDate } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { buildGrid } from '../grid/viewModel.js'
import { demoWeekspan } from '../grid/fixtures.js'
import { isSelected, moveSelection, reconcileSelection, selectionFromCell } from './selection.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35, matches viewModel.test.ts

describe('selectionFromCell / isSelected', () => {
  it('builds a selection naming exactly the given cell', () => {
    const sel = selectionFromCell('item-tiles', today)
    expect(sel).toEqual({ itemId: 'item-tiles', date: today })
  })

  it('matches only the exact (itemId, date) pair', () => {
    const sel = selectionFromCell('item-tiles', today)
    expect(isSelected(sel, 'item-tiles', today)).toBe(true)
    expect(isSelected(sel, 'item-tiles', '2026-08-27')).toBe(false)
    expect(isSelected(sel, 'item-roadmap', today)).toBe(false)
  })

  it('a null selection matches nothing', () => {
    expect(isSelected(null, 'item-tiles', today)).toBe(false)
  })
})

describe('moveSelection — arrow movement', () => {
  const vm = buildGrid(demoWeekspan(today), today)
  const firstRow = vm.rows[0]!
  const lastRow = vm.rows[vm.rows.length - 1]!
  const firstDate = vm.dates[0]!
  const lastDate = vm.dates[vm.dates.length - 1]!

  it('returns null for a null selection', () => {
    expect(moveSelection(null, vm, 'up')).toBeNull()
    expect(moveSelection(null, vm, 'right')).toBeNull()
  })

  it('left moves to the previous date in vm.dates', () => {
    const sel = selectionFromCell(firstRow.id, vm.dates[3]!)
    expect(moveSelection(sel, vm, 'left')).toEqual({ itemId: firstRow.id, date: vm.dates[2] })
  })

  it('right moves to the next date in vm.dates', () => {
    const sel = selectionFromCell(firstRow.id, vm.dates[3]!)
    expect(moveSelection(sel, vm, 'right')).toEqual({ itemId: firstRow.id, date: vm.dates[4] })
  })

  it('up moves to the previous row', () => {
    const sel = selectionFromCell(vm.rows[2]!.id, firstDate)
    expect(moveSelection(sel, vm, 'up')).toEqual({ itemId: vm.rows[1]!.id, date: firstDate })
  })

  it('down moves to the next row', () => {
    const sel = selectionFromCell(vm.rows[2]!.id, firstDate)
    expect(moveSelection(sel, vm, 'down')).toEqual({ itemId: vm.rows[3]!.id, date: firstDate })
  })

  it('left from the first day steps onto the ITEM column, not into a clamp', () => {
    // The frozen title cell is part of the same grid now, one step left of the
    // first date, so it is reachable without the mouse.
    const sel = selectionFromCell(firstRow.id, firstDate)
    expect(moveSelection(sel, vm, 'left')).toEqual({ itemId: firstRow.id, date: null })
  })

  it('clamps at the right edge instead of wrapping', () => {
    const sel = selectionFromCell(firstRow.id, lastDate)
    expect(moveSelection(sel, vm, 'right')).toEqual({ itemId: firstRow.id, date: lastDate })
  })

  it('clamps at the top row instead of wrapping', () => {
    const sel = selectionFromCell(firstRow.id, firstDate)
    expect(moveSelection(sel, vm, 'up')).toEqual({ itemId: firstRow.id, date: firstDate })
  })

  it('clamps at the bottom row instead of wrapping', () => {
    const sel = selectionFromCell(lastRow.id, firstDate)
    expect(moveSelection(sel, vm, 'down')).toEqual({ itemId: lastRow.id, date: firstDate })
  })

  it('returns null when the selected item no longer has a row', () => {
    const sel = selectionFromCell('item-does-not-exist', firstDate)
    expect(moveSelection(sel, vm, 'right')).toBeNull()
  })

  it('returns null when the selected date has fallen out of the window', () => {
    const sel = selectionFromCell(firstRow.id, '1999-01-01')
    expect(moveSelection(sel, vm, 'right')).toBeNull()
  })
})

describe('reconcileSelection', () => {
  it('returns null for a null selection', () => {
    const vm = buildGrid(demoWeekspan(today), today)
    expect(reconcileSelection(null, vm)).toBeNull()
  })

  it('survives a mutation that does not remove the selected item', () => {
    const weekspan = demoWeekspan(today)
    const vm1 = buildGrid(weekspan, today)
    const sel = selectionFromCell('item-tiles', vm1.dates[0]!)

    // A mutation elsewhere (marking an unrelated future day as vacation)
    // leaves item-tiles' row untouched.
    const mutated = { ...weekspan, vacationDays: [...weekspan.vacationDays, '2099-01-01'] }
    const vm2 = buildGrid(mutated, today)

    expect(reconcileSelection(sel, vm2)).toEqual(sel)
  })

  it('becomes null once the selected item is deleted', () => {
    const weekspan = demoWeekspan(today)
    const vm1 = buildGrid(weekspan, today)
    const sel = selectionFromCell('item-tiles', vm1.dates[0]!)

    const withoutItem = {
      ...weekspan,
      items: weekspan.items.filter((i) => i.id !== 'item-tiles'),
    }
    const vm2 = buildGrid(withoutItem, today)

    expect(reconcileSelection(sel, vm2)).toBeNull()
  })
})

describe('moveSelection — the ITEM column', () => {
  const vm = buildGrid(demoWeekspan(today), today)
  const firstRow = vm.rows[0]!
  const firstDate = vm.dates[0]!
  const itemSel = { itemId: firstRow.id, date: null }

  it('left clamps there — it is the far edge', () => {
    expect(moveSelection(itemSel, vm, 'left')).toEqual(itemSel)
  })

  it('right returns to the first day of the window', () => {
    expect(moveSelection(itemSel, vm, 'right')).toEqual({ itemId: firstRow.id, date: firstDate })
  })

  it('up and down walk items while staying on the item column', () => {
    const down = moveSelection(itemSel, vm, 'down')!
    expect(down.date).toBeNull()
    expect(down.itemId).toBe(vm.rows[1]!.id)

    const backUp = moveSelection(down, vm, 'up')!
    expect(backUp).toEqual(itemSel)
  })

  it('clamps at the top and bottom of the list', () => {
    expect(moveSelection(itemSel, vm, 'up')).toEqual(itemSel)
    const last = { itemId: vm.rows[vm.rows.length - 1]!.id, date: null }
    expect(moveSelection(last, vm, 'down')).toEqual(last)
  })

  it('a round trip right-then-left comes back to the same title', () => {
    const right = moveSelection(itemSel, vm, 'right')!
    expect(moveSelection(right, vm, 'left')).toEqual(itemSel)
  })

  it('still returns null for a row that no longer exists', () => {
    expect(moveSelection({ itemId: 'ghost', date: null }, vm, 'down')).toBeNull()
  })
})
