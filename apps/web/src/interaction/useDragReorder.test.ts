import type { IsoDate, Item, Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan, minimalMoveRank, rankSequence } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { buildGrid } from '../grid/viewModel.js'
import type { GridVM, RowVM } from '../grid/viewModel.js'
import { demoWeekspan } from '../grid/fixtures.js'
import { dropTargetFor, type RowRects } from './useDragReorder.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35

/**
 * Lays rows out top-to-bottom exactly as the grid renders them, honouring
 * `heights` for any row that should be taller than the default (e.g. a
 * wrapping title) — this is what makes the "varied row heights" tests
 * meaningful rather than assuming a uniform row height.
 */
function stackRects(rows: readonly RowVM[], heights: Record<string, number> = {}): RowRects {
  const rects = new Map<string, { top: number; height: number }>()
  let top = 0
  for (const row of rows) {
    const height = heights[row.id] ?? 30
    rects.set(row.id, { top, height })
    top += height
  }
  return rects
}

// demoWeekspan's root order (by rank) is: tiles, roadmap, passport,
// dishwasher (+ its one child, order-dishwasher), paint, perf, waterPlants.
// `item-tiles` and `item-perf` are given taller-than-default rects below so
// every "root" test is already exercising unequal row heights.
const DEMO_HEIGHTS = { 'item-tiles': 40, 'item-perf': 54 }

describe('dropTargetFor — root reordering', () => {
  const vm = buildGrid(demoWeekspan(today), today)
  const rects = stackRects(vm.rows, DEMO_HEIGHTS)

  it('dropping a root between two other roots yields the correct before/after pair', () => {
    // item-dishwasher's group spans rects top 100..160 (it carries its one
    // child); its midpoint is 130. A pointer at 110 is inside that group's
    // span but above its midpoint, so the drop resolves to "just before the
    // dishwasher group" — i.e. between item-passport and item-dishwasher.
    const target = dropTargetFor(vm, 'item-roadmap', 110, rects)
    expect(target).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'item-dishwasher'),
      beforeId: 'item-passport',
      afterId: 'item-dishwasher',
    })
  })

  it('dropping a root at the very top lands before the first root', () => {
    const target = dropTargetFor(vm, 'item-perf', -1000, rects)
    expect(target).toEqual({ index: 0, beforeId: null, afterId: 'item-tiles' })
  })

  it('dropping a root at the very bottom lands after the last root', () => {
    const target = dropTargetFor(vm, 'item-tiles', 100000, rects)
    expect(target).toEqual({
      index: vm.rows.length,
      beforeId: 'item-water-plants',
      afterId: null,
    })
  })

  it('a root drag never resolves to a child row, even when the pointer sits on top of one', () => {
    // item-order-dishwasher (a child) occupies rect top 130..160, midpoint 145.
    // Hovering squarely inside it while dragging a ROOT must still resolve
    // against the whole dishwasher GROUP, never name the child directly —
    // otherwise a root could visually land "inside" another item's block.
    const target = dropTargetFor(vm, 'item-roadmap', 145, rects)
    expect(target!.beforeId).not.toBe('item-order-dishwasher')
    expect(target!.afterId).not.toBe('item-order-dishwasher')
    expect(target).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'item-paint'),
      beforeId: 'item-dishwasher',
      afterId: 'item-paint',
    })
  })

  it('a tall wrapping row (item-perf, height 54) still resolves correctly by its true rect, not an assumed uniform height', () => {
    // perf spans rects top 190..244 (taller than the default 30px row used
    // everywhere else); its true midpoint is 217. A naive implementation
    // that assumed every row was the same height would misplace this.
    const beforePerfMidpoint = dropTargetFor(vm, 'item-tiles', 200, rects)
    expect(beforePerfMidpoint).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'item-perf'),
      beforeId: 'item-paint',
      afterId: 'item-perf',
    })

    const afterPerfMidpoint = dropTargetFor(vm, 'item-tiles', 230, rects)
    expect(afterPerfMidpoint).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'item-water-plants'),
      beforeId: 'item-perf',
      afterId: 'item-water-plants',
    })
  })

  it('a drop resolving to the current position reports no move, so the caller writes nothing', () => {
    const weekspan = demoWeekspan(today)
    // item-passport's current rect span is 70..100 — dropping anywhere
    // within it should resolve to its own existing neighbours.
    const target = dropTargetFor(vm, 'item-passport', 85, rects)
    expect(target).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'item-dishwasher'),
      beforeId: 'item-roadmap',
      afterId: 'item-dishwasher',
    })

    const moving = weekspan.items.find((i) => i.id === 'item-passport')!
    const before = weekspan.items.find((i) => i.id === target!.beforeId)!
    const after = weekspan.items.find((i) => i.id === target!.afterId)!
    expect(minimalMoveRank(moving, before, after, weekspan.items)).toBeNull()
  })
})

/** Two roots, each with several children — enough to prove a child never escapes its own parent's block. */
function multiChildWeekspan(): Weekspan {
  const rootRanks = rankSequence(2)
  const childRanksA = rankSequence(3)
  const childRanksB = rankSequence(2)

  const items: Item[] = [
    { id: 'parent-a', title: 'parent a', rank: rootRanks[0]!, marks: {} },
    { id: 'a1', title: 'a1', rank: childRanksA[0]!, marks: {}, parentId: 'parent-a' },
    { id: 'a2', title: 'a2', rank: childRanksA[1]!, marks: {}, parentId: 'parent-a' },
    { id: 'a3', title: 'a3', rank: childRanksA[2]!, marks: {}, parentId: 'parent-a' },
    { id: 'parent-b', title: 'parent b', rank: rootRanks[1]!, marks: {} },
    { id: 'b1', title: 'b1', rank: childRanksB[0]!, marks: {}, parentId: 'parent-b' },
    { id: 'b2', title: 'b2', rank: childRanksB[1]!, marks: {}, parentId: 'parent-b' },
  ]
  return createWeekspan({ items })
}

describe('dropTargetFor — child reordering is sibling-scoped', () => {
  const vm: GridVM = buildGrid(multiChildWeekspan(), today)
  // rows: parent-a(0) a1(1) a2(2) a3(3) parent-b(4) b1(5) b2(6)
  const rects = stackRects(vm.rows)

  it('dragging a child is constrained to its own sibling group', () => {
    // a2's true neighbours are a1 (before) and a3 (after).
    const target = dropTargetFor(vm, 'a2', rects.get('a2')!.top, rects)
    expect(target).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'a3'),
      beforeId: 'a1',
      afterId: 'a3',
    })
  })

  it('a child dragged toward another parent still resolves within its own group, never adopting the other parent', () => {
    // Point the pointer squarely at b2, deep inside parent-b's children —
    // a naive per-row-midpoint implementation with no group scoping could
    // easily let a1 land there. It must instead clamp to the end of
    // parent-a's own block.
    const b2Rect = rects.get('b2')!
    const target = dropTargetFor(vm, 'a1', b2Rect.top + b2Rect.height / 2, rects)
    expect(target!.beforeId).not.toBe('b1')
    expect(target!.beforeId).not.toBe('b2')
    expect(target!.afterId).not.toBe('b1')
    expect(target!.afterId).not.toBe('b2')
    expect(target).toEqual({
      index: vm.rows.findIndex((r) => r.id === 'parent-b'), // end of parent-a's block
      beforeId: 'a3',
      afterId: null,
    })
  })

  it('rejects a two-level-deep nesting shape: a root drag never targets a grandchild position and a child drag never targets outside its own parent', () => {
    // Dragging parent-a (a root) with the pointer over a1 (its own first
    // child) must resolve against parent-a's own group boundaries — the
    // dragged group is excluded from its own candidate list entirely — and
    // must never suggest inserting "inside" the a1/a2/a3 block.
    const a1Rect = rects.get('a1')!
    const target = dropTargetFor(vm, 'parent-a', a1Rect.top, rects)
    // Neither boundary may ever be one of parent-a's own children — that
    // would put a root "inside" a child's block, i.e. two levels of nesting.
    expect(target).toEqual({ index: vm.rows.findIndex((r) => r.id === 'parent-b'), beforeId: null, afterId: 'parent-b' })
  })
})

describe('dropTargetFor — unknown id', () => {
  it('returns null when draggingId does not name a row in vm', () => {
    const vm = buildGrid(demoWeekspan(today), today)
    const rects = stackRects(vm.rows)
    expect(dropTargetFor(vm, 'not-a-real-id', 0, rects)).toBeNull()
  })
})
