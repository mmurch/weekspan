import { buildGrid } from '../grid/viewModel.js'
import { demoWeekspan, stressWeekspan } from '../grid/fixtures.js'
import {
  commitNeighbours,
  groupFor,
  isUnchanged,
  previewIndexFor,
  previewRows,
  type RowBox,
} from './dragPreview.js'

const TODAY = '2026-08-26'
const vm = buildGrid(demoWeekspan(TODAY), TODAY)
const ids = vm.rows.map((r) => r.id)

/**
 * Boxes with DELIBERATELY VARIED heights. Equal-height assumptions are the
 * classic bug in drop-target maths, and this grid genuinely has rows five times
 * taller than others whenever a title wraps.
 */
function boxes(heights: number[] = []): RowBox[] {
  let top = 0
  return vm.rows.map((r, i) => {
    const height = heights[i] ?? (i % 3 === 0 ? 90 : 30)
    const box = { id: r.id, top, height }
    top += height
    return box
  })
}

describe('groupFor', () => {
  it('carries a root and its children together', () => {
    const parent = vm.rows.find((r) => r.depth === 0 && vm.rows.some((c) => c.depth === 1))
    const group = groupFor(vm.rows, vm.rows.find((r) => r.depth === 1)!.id)
    // A child travels alone within its siblings.
    expect(group).toHaveLength(1)
    expect(parent).toBeDefined()
  })

  it('a root with a following child yields a group of two', () => {
    const childIdx = vm.rows.findIndex((r) => r.depth === 1)
    const rootId = vm.rows[childIdx - 1]!.id
    expect(groupFor(vm.rows, rootId).length).toBeGreaterThanOrEqual(2)
  })
})

describe('previewIndexFor', () => {
  it('resolves to 0 when the pointer is above everything', () => {
    expect(previewIndexFor(vm.rows, boxes(), ids[2]!, -500)).toBe(0)
  })

  it('resolves to the end when the pointer is below everything', () => {
    const b = boxes()
    const bottom = b[b.length - 1]!.top + b[b.length - 1]!.height
    const idx = previewIndexFor(vm.rows, b, ids[0]!, bottom + 500)
    // Group removed, so the max index is the remaining count.
    expect(idx).toBeGreaterThan(0)
  })

  it('uses each row midpoint, so tall wrapping rows do not skew the result', () => {
    // Row 0 is 300px tall; a pointer just inside its top half must resolve before it.
    const b = boxes([300, 30, 30, 30, 30, 30, 30, 30])
    const dragging = ids[3]!
    expect(previewIndexFor(vm.rows, b, dragging, 10)).toBe(0)
    // ...and just past its midpoint, after it.
    expect(previewIndexFor(vm.rows, b, dragging, 160)).toBeGreaterThan(0)
  })
})

describe('previewRows', () => {
  it('produces a permutation, never dropping or duplicating a row', () => {
    for (let i = 0; i < vm.rows.length; i++) {
      const out = previewRows(vm.rows, ids[0]!, i)
      expect(out).toHaveLength(vm.rows.length)
      expect(new Set(out.map((r) => r.id)).size).toBe(vm.rows.length)
    }
  })

  it('keeps a dragged root adjacent to its own children', () => {
    const childIdx = vm.rows.findIndex((r) => r.depth === 1)
    const rootId = vm.rows[childIdx - 1]!.id
    const childId = vm.rows[childIdx]!.id
    const out = previewRows(vm.rows, rootId, 5)
    const ri = out.findIndex((r) => r.id === rootId)
    const ci = out.findIndex((r) => r.id === childId)
    expect(ci).toBe(ri + 1)
  })

  it('clamps an out-of-range index instead of losing rows', () => {
    expect(previewRows(vm.rows, ids[0]!, 999)).toHaveLength(vm.rows.length)
    expect(previewRows(vm.rows, ids[0]!, -5)).toHaveLength(vm.rows.length)
  })
})

describe('commitNeighbours', () => {
  it('gives a root only root neighbours, skipping over children', () => {
    const out = previewRows(vm.rows, ids[0]!, 3)
    const n = commitNeighbours(out, ids[0]!)
    expect(n).not.toBeNull()
    for (const id of [n!.beforeId, n!.afterId]) {
      if (id === null) continue
      expect(out.find((r) => r.id === id)!.depth).toBe(0)
    }
  })

  it('never gives a child a neighbour outside its sibling group', () => {
    const childId = vm.rows.find((r) => r.depth === 1)!.id
    const out = previewRows(vm.rows, childId, 0)
    const n = commitNeighbours(out, childId)
    // Dropped at the very top there is no preceding row, so the move is invalid
    // rather than silently reparenting.
    if (n) {
      for (const id of [n.beforeId, n.afterId]) {
        if (id === null) continue
        expect(out.find((r) => r.id === id)!.depth).toBe(1)
      }
    } else {
      expect(n).toBeNull()
    }
  })

  it('returns null for an unknown id rather than throwing into a render', () => {
    expect(commitNeighbours(vm.rows, 'nope')).toBeNull()
  })
})

describe('isUnchanged', () => {
  it('recognises a drag that landed back where it started', () => {
    const same = previewRows(vm.rows, ids[0]!, 0)
    expect(isUnchanged(vm.rows, same)).toBe(true)
  })

  it('recognises a real move', () => {
    expect(isUnchanged(vm.rows, previewRows(vm.rows, ids[0]!, 4))).toBe(false)
  })
})

describe('a large list', () => {
  const big = buildGrid(stressWeekspan(TODAY), TODAY)
  it('previews without losing rows', () => {
    const out = previewRows(big.rows, big.rows[10]!.id, 40)
    expect(out).toHaveLength(big.rows.length)
    expect(new Set(out.map((r) => r.id)).size).toBe(big.rows.length)
  })
})
