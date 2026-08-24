import { orderItems, parse, serialize, siblingsOf } from '@weekspan/weekspan-core'
import { demoWeekspan } from '../grid/fixtures.js'
import { canIndent, canOutdent, indentItem, outdentItem } from './nesting.js'

const TODAY = '2026-08-26'

// demoWeekspan roots in rank order: item-tiles, item-roadmap, item-passport,
// item-dishwasher (has child item-order-dishwasher), item-paint, item-perf,
// item-water-plants.

describe('canIndent / canOutdent', () => {
  it('a root with a preceding root can indent', () => {
    const w = demoWeekspan(TODAY)
    expect(canIndent(w, 'item-roadmap')).toBe(true)
  })

  it('the very first root cannot indent — no preceding root', () => {
    const w = demoWeekspan(TODAY)
    expect(canIndent(w, 'item-tiles')).toBe(false)
  })

  it('an item that is already a child cannot indent further', () => {
    const w = demoWeekspan(TODAY)
    expect(canIndent(w, 'item-order-dishwasher')).toBe(false)
  })

  it('an item that has children cannot indent — would grandparent them', () => {
    const w = demoWeekspan(TODAY)
    expect(canIndent(w, 'item-dishwasher')).toBe(false)
  })

  it('a nonexistent item cannot indent or outdent', () => {
    const w = demoWeekspan(TODAY)
    expect(canIndent(w, 'no-such-id')).toBe(false)
    expect(canOutdent(w, 'no-such-id')).toBe(false)
  })

  it('a root cannot outdent', () => {
    const w = demoWeekspan(TODAY)
    expect(canOutdent(w, 'item-roadmap')).toBe(false)
  })

  it('a child can outdent', () => {
    const w = demoWeekspan(TODAY)
    expect(canOutdent(w, 'item-order-dishwasher')).toBe(true)
  })
})

describe('indentItem', () => {
  it('nests the item under the nearest preceding root', () => {
    const w = demoWeekspan(TODAY)
    const next = indentItem(w, 'item-roadmap')
    expect(next).not.toBeNull()
    const item = next!.items.find((i) => i.id === 'item-roadmap')!
    expect(item.parentId).toBe('item-tiles')
  })

  it('places it LAST among its new siblings', () => {
    const w = demoWeekspan(TODAY)
    // item-dishwasher already has one child (item-order-dishwasher). Indent
    // item-paint, whose preceding root is item-dishwasher.
    const next = indentItem(w, 'item-paint')!
    const siblings = siblingsOf(next.items, 'item-dishwasher')
    expect(siblings.map((i) => i.id)).toEqual(['item-order-dishwasher', 'item-paint'])
  })

  it('refuses (returns null) on the first root', () => {
    const w = demoWeekspan(TODAY)
    expect(indentItem(w, 'item-tiles')).toBeNull()
  })

  it('refuses (returns null) on an item already nested', () => {
    const w = demoWeekspan(TODAY)
    expect(indentItem(w, 'item-order-dishwasher')).toBeNull()
  })

  it('refuses (returns null) on an item that has children', () => {
    const w = demoWeekspan(TODAY)
    expect(indentItem(w, 'item-dishwasher')).toBeNull()
  })

  it('refuses (returns null) on a nonexistent item, never throws', () => {
    const w = demoWeekspan(TODAY)
    expect(() => indentItem(w, 'no-such-id')).not.toThrow()
    expect(indentItem(w, 'no-such-id')).toBeNull()
  })

  it('does not move any other item', () => {
    const w = demoWeekspan(TODAY)
    const next = indentItem(w, 'item-roadmap')!
    for (const before of w.items) {
      if (before.id === 'item-roadmap') continue
      expect(next.items.find((i) => i.id === before.id)).toEqual(before)
    }
  })

  it('the result survives parse(serialize(w)) — one-level nesting holds', () => {
    const w = demoWeekspan(TODAY)
    const next = indentItem(w, 'item-roadmap')!
    expect(() => parse(serialize(next))).not.toThrow()
  })
})

describe('outdentItem', () => {
  it('makes a child a root again', () => {
    const w = demoWeekspan(TODAY)
    const next = outdentItem(w, 'item-order-dishwasher')!
    const item = next.items.find((i) => i.id === 'item-order-dishwasher')!
    expect(item.parentId == null).toBe(true)
  })

  it('ranks it immediately after its former parent among roots', () => {
    const w = demoWeekspan(TODAY)
    const next = outdentItem(w, 'item-order-dishwasher')!
    const roots = orderItems(next.items).filter((i) => i.parentId == null)
    const parentIdx = roots.findIndex((i) => i.id === 'item-dishwasher')
    expect(roots[parentIdx + 1]!.id).toBe('item-order-dishwasher')
  })

  it('refuses (returns null) on a root', () => {
    const w = demoWeekspan(TODAY)
    expect(outdentItem(w, 'item-roadmap')).toBeNull()
  })

  it('refuses (returns null) on a nonexistent item, never throws', () => {
    const w = demoWeekspan(TODAY)
    expect(() => outdentItem(w, 'no-such-id')).not.toThrow()
    expect(outdentItem(w, 'no-such-id')).toBeNull()
  })

  it('does not move any other item', () => {
    const w = demoWeekspan(TODAY)
    const next = outdentItem(w, 'item-order-dishwasher')!
    for (const before of w.items) {
      if (before.id === 'item-order-dishwasher') continue
      expect(next.items.find((i) => i.id === before.id)).toEqual(before)
    }
  })

  it('the result survives parse(serialize(w))', () => {
    const w = demoWeekspan(TODAY)
    const next = outdentItem(w, 'item-order-dishwasher')!
    expect(() => parse(serialize(next))).not.toThrow()
  })

  it('indent then outdent round-trips back to a root ranked after its (former) preceding root', () => {
    const w = demoWeekspan(TODAY)
    const indented = indentItem(w, 'item-roadmap')! // now a child of item-tiles
    const back = outdentItem(indented, 'item-roadmap')!
    const roots = orderItems(back.items).filter((i) => i.parentId == null)
    const tilesIdx = roots.findIndex((i) => i.id === 'item-tiles')
    expect(roots[tilesIdx + 1]!.id).toBe('item-roadmap')
  })
})

describe('canIndent/canOutdent agree with what the mutations actually do', () => {
  const w = demoWeekspan(TODAY)
  const allIds = w.items.map((i) => i.id)

  for (const id of allIds) {
    it(`indent(${id}): canIndent matches indentItem's null-ness`, () => {
      const allowed = canIndent(w, id)
      const result = indentItem(w, id)
      expect(result !== null).toBe(allowed)
    })

    it(`outdent(${id}): canOutdent matches outdentItem's null-ness`, () => {
      const allowed = canOutdent(w, id)
      const result = outdentItem(w, id)
      expect(result !== null).toBe(allowed)
    })
  }
})
