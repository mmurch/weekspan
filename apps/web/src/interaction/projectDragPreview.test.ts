import { createWeekspan, rankSequence, type Item, type Weekspan } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { buildProjectView, type ProjectRow } from '../grid/projectView.js'
import { applyProjectDrop, dropFromRows } from './projectDrag.js'
import {
  dividerKey,
  isProjectUnchanged,
  previewProjectIndexFor,
  previewProjectRows,
  projectGroupFor,
  type ProjectRowBox,
} from './projectDragPreview.js'

const TODAY = '2026-08-26'

function ws(): Weekspan {
  const r = rankSequence(5)
  const items: Item[] = [
    { id: 'a', title: 'a', rank: r[0]!, marks: {}, projectId: 'work' },
    { id: 'b', title: 'b', rank: r[1]!, marks: {}, projectId: 'home' },
    { id: 'c', title: 'c', rank: r[2]!, marks: {}, projectId: 'work' },
    { id: 'd', title: 'd', rank: r[3]!, marks: {} },
    { id: 'e', title: 'e', rank: r[4]!, marks: {}, projectId: 'home' },
  ]
  return createWeekspan({
    projects: [
      { id: 'work', name: 'Work', colorToken: 'barA' },
      { id: 'home', name: 'Home', colorToken: 'barB' },
      { id: 'empty', name: 'Empty', colorToken: 'barC' },
    ],
    items,
  })
}

const rowsOf = (w: Weekspan = ws()): ProjectRow[] => buildProjectView(w, TODAY).rows

/** A compact, readable rendering of the list: `#group` for dividers, ids for items. */
function shape(rows: readonly ProjectRow[]): string[] {
  return rows.map((r) => (r.kind === 'divider' ? `#${r.projectId ?? 'none'}` : r.row.id))
}

/**
 * Index of the first slot inside `projectId`'s group, in REST space — the list
 * with `draggingId` already lifted out, which is the space both
 * `previewProjectIndexFor` and `previewProjectRows` work in. Computing it
 * against the full list is off by one whenever the dragged row sits above the
 * target divider.
 */
function firstSlotOf(
  rows: readonly ProjectRow[],
  draggingId: string,
  projectId: string | null,
): number {
  const group = new Set(projectGroupFor(rows, draggingId))
  const rest = rows.filter((_, i) => !group.has(i))
  return rest.findIndex((r) => r.kind === 'divider' && r.projectId === projectId) + 1
}

/** Uniform 20px boxes, in list order — enough to drive index maths deterministically. */
function boxes(rows: readonly ProjectRow[], skip: readonly number[] = []): ProjectRowBox[] {
  const out: ProjectRowBox[] = []
  let top = 0
  rows.forEach((_, index) => {
    if (skip.includes(index)) return
    out.push({ index, top, height: 20 })
    top += 20
  })
  return out
}

describe('dividerKey', () => {
  it('gives the unassigned bucket a stable non-empty key', () => {
    // `null` cannot survive a data- attribute round trip, and '' is not a valid
    // selector value either.
    expect(dividerKey(null)).toBe('__none__')
    expect(dividerKey('work')).toBe('work')
  })
})

describe('projectGroupFor', () => {
  it('returns the row index of the dragged item', () => {
    const rows = rowsOf()
    const idx = rows.findIndex((r) => r.kind === 'item' && r.row.id === 'a')
    expect(projectGroupFor(rows, 'a')).toEqual([idx])
  })

  it('is empty for an id that is not in the list', () => {
    expect(projectGroupFor(rowsOf(), 'nope')).toEqual([])
  })
})

describe('previewProjectRows', () => {
  it('moves the dragged row and leaves every divider in place', () => {
    const rows = rowsOf()
    const before = shape(rows).filter((s) => s.startsWith('#'))
    const previewed = previewProjectRows(rows, 'a', rows.length)
    expect(shape(previewed).filter((s) => s.startsWith('#'))).toEqual(before)
    // Same rows, different order.
    expect([...shape(previewed)].sort()).toEqual([...shape(rows)].sort())
  })

  it('lands the row in whichever group it was dropped under', () => {
    const rows = rowsOf()
    // Index 1 is the slot immediately after the first divider.
    const previewed = previewProjectRows(rows, 'e', 1)
    expect(shape(previewed)[1]).toBe('e')
    const drop = dropFromRows(previewed, 'e')!
    expect(drop.projectId).toBe(shape(rows)[0]!.slice(1))
  })

  it('refuses to park a row above the first divider', () => {
    // `dropFromRows` resolves a group by scanning UP for a divider and returns
    // null without one, so index 0 would render a row that could not commit.
    const rows = rowsOf()
    const previewed = previewProjectRows(rows, 'c', 0)
    expect(shape(previewed)[0]!.startsWith('#')).toBe(true)
    expect(dropFromRows(previewed, 'c')).not.toBeNull()
  })

  it('returns the list untouched for an unknown id', () => {
    const rows = rowsOf()
    expect(shape(previewProjectRows(rows, 'nope', 3))).toEqual(shape(rows))
  })
})

describe('previewProjectIndexFor', () => {
  it('never returns an index above the first divider', () => {
    const rows = rowsOf()
    const idx = previewProjectIndexFor(rows, boxes(rows), 'c', -9999)
    expect(idx).toBeGreaterThanOrEqual(1)
    expect(shape(previewProjectRows(rows, 'c', idx))[0]!.startsWith('#')).toBe(true)
  })

  it('a pointer past the end puts the row last', () => {
    const rows = rowsOf()
    const idx = previewProjectIndexFor(rows, boxes(rows), 'a', 9999)
    const previewed = previewProjectRows(rows, 'a', idx)
    expect(shape(previewed).at(-1)).toBe('a')
  })

  it('walks the row under the pointer, using per-row midpoints', () => {
    const rows = rowsOf()
    const dragged = 'a'
    const group = new Set(projectGroupFor(rows, dragged))
    const b = boxes(rows, [...group])
    // Just past the midpoint of the first remaining box -> index 1.
    expect(previewProjectIndexFor(rows, b, dragged, 11)).toBe(1)
    // Just past the second -> index 2.
    expect(previewProjectIndexFor(rows, b, dragged, 31)).toBe(2)
  })
})

describe('isProjectUnchanged', () => {
  it('is true for the list compared with itself', () => {
    const rows = rowsOf()
    expect(isProjectUnchanged(rows, rows)).toBe(true)
  })

  it('is false once a row has moved', () => {
    const rows = rowsOf()
    expect(isProjectUnchanged(rows, previewProjectRows(rows, 'a', rows.length))).toBe(false)
  })
})

describe('preview + drop, end to end — the regression this fixes', () => {
  it('dropping into another group changes the projectId', () => {
    // The whole bug: `dropFromRows` was handed the COMMITTED rows, so it always
    // found the item at its existing position and resolved to its own current
    // group and neighbours. `applyProjectDrop` then correctly wrote nothing.
    const w = ws()
    const rows = buildProjectView(w, TODAY).rows

    // 'a' is in Work. Preview it into the Home group, then commit.
    const previewed = previewProjectRows(rows, 'a', firstSlotOf(rows, 'a', 'home'))
    const drop = dropFromRows(previewed, 'a')!
    expect(drop.projectId).toBe('home')

    const next = applyProjectDrop(w, drop)!
    expect(next).not.toBeNull()
    expect(next.items.find((i) => i.id === 'a')!.projectId).toBe('home')
  })

  it('dropping into an EMPTY group works — the divider is the only landing slot', () => {
    const w = ws()
    const rows = buildProjectView(w, TODAY).rows
    expect(rows.some((r) => r.kind === 'divider' && r.projectId === 'empty')).toBe(true)

    const previewed = previewProjectRows(rows, 'a', firstSlotOf(rows, 'a', 'empty'))
    const drop = dropFromRows(previewed, 'a')!
    expect(drop.projectId).toBe('empty')
    expect(applyProjectDrop(w, drop)!.items.find((i) => i.id === 'a')!.projectId).toBe('empty')
  })

  it('a drop back where it started writes nothing', () => {
    const w = ws()
    const rows = buildProjectView(w, TODAY).rows
    const idx = rows.findIndex((r) => r.kind === 'item' && r.row.id === 'c')
    const previewed = previewProjectRows(rows, 'c', idx)
    expect(isProjectUnchanged(rows, previewed)).toBe(true)
    // And even if it were committed, it resolves to a no-op rather than a diff.
    expect(applyProjectDrop(w, dropFromRows(previewed, 'c')!)).toBeNull()
  })

  it('reordering WITHIN a group changes rank but not project', () => {
    const w = ws()
    const rows = buildProjectView(w, TODAY).rows

    // 'c' is the second Work item; move it to the top of its own group.
    const previewed = previewProjectRows(rows, 'c', firstSlotOf(rows, 'c', 'work'))
    const drop = dropFromRows(previewed, 'c')!
    expect(drop.projectId).toBe('work')

    const next = applyProjectDrop(w, drop)!
    const moved = next.items.find((i) => i.id === 'c')!
    expect(moved.projectId).toBe('work')
    expect(moved.rank).not.toBe(w.items.find((i) => i.id === 'c')!.rank)
  })
})
