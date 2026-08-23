/**
 * Cell selection — pure state, no React, no DOM.
 *
 * A `Selection` names one grid cell by `(itemId, date)` rather than by row/column
 * index, so it survives a re-render even when rows are re-ordered or the window
 * shifts. It does NOT survive the item itself vanishing (deleted, archived by
 * week close-out, etc.) — see `reconcileSelection`.
 */

import type { IsoDate } from '@weekspan/weekspan-core'
import type { GridVM } from '../grid/viewModel.js'

export interface Selection {
  itemId: string
  date: IsoDate
}

export function selectionFromCell(itemId: string, date: IsoDate): Selection {
  return { itemId, date }
}

export function isSelected(sel: Selection | null, itemId: string, date: IsoDate): boolean {
  return sel !== null && sel.itemId === itemId && sel.date === date
}

/**
 * Arrow-key movement. Left/right walk `vm.dates`; up/down walk `vm.rows`
 * (which already interleaves parents and children in display order). Every
 * direction CLAMPS at its edge rather than wrapping — wrapping in a
 * spreadsheet loses your place, it does not save a keystroke.
 *
 * Returns null (rather than a dangling selection) if `sel` no longer names a
 * cell that exists in `vm` — the row was removed, or the date fell outside
 * the current window.
 */
export function moveSelection(
  sel: Selection | null,
  vm: GridVM,
  dir: 'up' | 'down' | 'left' | 'right',
): Selection | null {
  if (sel === null) return null

  const rowIndex = vm.rows.findIndex((r) => r.id === sel.itemId)
  const dateIndex = vm.dates.indexOf(sel.date)
  if (rowIndex === -1 || dateIndex === -1) return null

  switch (dir) {
    case 'left': {
      const next = Math.max(0, dateIndex - 1)
      return { itemId: sel.itemId, date: vm.dates[next]! }
    }
    case 'right': {
      const next = Math.min(vm.dates.length - 1, dateIndex + 1)
      return { itemId: sel.itemId, date: vm.dates[next]! }
    }
    case 'up': {
      const next = Math.max(0, rowIndex - 1)
      return { itemId: vm.rows[next]!.id, date: sel.date }
    }
    case 'down': {
      const next = Math.min(vm.rows.length - 1, rowIndex + 1)
      return { itemId: vm.rows[next]!.id, date: sel.date }
    }
  }
}

/**
 * Re-validate a selection against a freshly built `GridVM` after the
 * underlying weekspan changed for some reason other than a selection-driven
 * move (e.g. another device deleted the item). Returns `sel` unchanged when
 * the item still has a row, `null` when it does not.
 *
 * Deliberately does not check that `sel.date` is still within `vm.dates` —
 * the window only ever grows to the right, so a previously-valid date is not
 * expected to fall out of it.
 */
export function reconcileSelection(sel: Selection | null, vm: GridVM): Selection | null {
  if (sel === null) return null
  return vm.rows.some((r) => r.id === sel.itemId) ? sel : null
}
