import { orderItems } from '@weekspan/weekspan-core'
import { buildGrid } from '../grid/viewModel.js'
import { demoWeekspan } from '../grid/fixtures.js'
import { commitEdit } from './commitEdit.js'

const TODAY = '2026-08-26'
const base = demoWeekspan(TODAY)
const rows = buildGrid(base, TODAY).rows

describe('editing an existing title', () => {
  it('changes the title', () => {
    const id = rows[0]!.id
    const next = commitEdit(base, { kind: 'existing', itemId: id }, 'a new title')
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === id)!.title).toBe('a new title')
  })

  it('writes nothing when the title is unchanged', () => {
    const item = base.items[0]!
    expect(commitEdit(base, { kind: 'existing', itemId: item.id }, item.title)).toBeNull()
  })

  it('trims before comparing, so whitespace alone is not a change', () => {
    const item = base.items[0]!
    expect(commitEdit(base, { kind: 'existing', itemId: item.id }, `  ${item.title}  `)).toBeNull()
  })

  it('DELETES the item when the title is blanked', () => {
    // Reversed deliberately: an item with no title is not something the grid can
    // render or the user can act on, so leaving it behind as an invisible row
    // was worse than removing it. The caller names what went — see App.
    const id = rows[0]!.id
    const next = commitEdit(base, { kind: 'existing', itemId: id }, '   ')
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === id)).toBeUndefined()
    // Pure: the input is untouched.
    expect(base.items.find((i) => i.id === id)).toBeDefined()
  })

  it('takes an item\'s children with it, so no parentId is left dangling', () => {
    // parse() rejects an item whose parentId names nothing, so orphans would
    // make the file unloadable on the very next read.
    const parent = base.items.find((i) => base.items.some((c) => c.parentId === i.id))
    if (!parent) return
    const next = commitEdit(base, { kind: 'existing', itemId: parent.id }, '')!
    expect(next.items.some((i) => i.parentId === parent.id)).toBe(false)
    for (const item of next.items) {
      if (item.parentId != null) expect(next.items.some((i) => i.id === item.parentId)).toBe(true)
    }
  })
})

describe('creating a new item in a gap', () => {
  function roots(w = base) {
    return orderItems(w.items).filter((i) => i.parentId == null)
  }

  it('lands between its two neighbours', () => {
    const [a, b] = roots()
    const next = commitEdit(
      base,
      { kind: 'new', afterId: a!.id, beforeId: b!.id, parentId: null },
      'inserted',
    )
    expect(next).not.toBeNull()
    const order = orderItems(next!.items).map((i) => i.title)
    expect(order.indexOf('inserted')).toBe(order.indexOf(a!.title) + 1)
  })

  it('moves no other item — the new rank sits between, nothing else shifts', () => {
    const [a, b] = roots()
    const next = commitEdit(
      base,
      { kind: 'new', afterId: a!.id, beforeId: b!.id, parentId: null },
      'inserted',
    )!
    for (const before of base.items) {
      expect(next.items.find((i) => i.id === before.id)!.rank).toBe(before.rank)
    }
  })

  it('works at the very top and the very bottom', () => {
    const all = roots()
    const top = commitEdit(
      base,
      { kind: 'new', afterId: null, beforeId: all[0]!.id, parentId: null },
      'first',
    )!
    expect(orderItems(top.items)[0]!.title).toBe('first')

    const bottom = commitEdit(
      base,
      { kind: 'new', afterId: all[all.length - 1]!.id, beforeId: null, parentId: null },
      'last',
    )!
    const ordered = orderItems(bottom.items)
    expect(ordered[ordered.length - 1]!.title).toBe('last')
  })

  it('creates a child when the gap belongs to a child scope', () => {
    const parent = base.items.find((p) => base.items.some((c) => c.parentId === p.id))!
    const child = base.items.find((c) => c.parentId === parent.id)!
    const next = commitEdit(
      base,
      { kind: 'new', afterId: child.id, beforeId: null, parentId: parent.id },
      'sibling of child',
    )!
    expect(next.items.find((i) => i.title === 'sibling of child')!.parentId).toBe(parent.id)
  })

  it('discards a blank draft silently', () => {
    expect(
      commitEdit(base, { kind: 'new', afterId: null, beforeId: null, parentId: null }, '   '),
    ).toBeNull()
  })

  it('returns null rather than throwing when insertItem rejects the anchor', () => {
    // A cross-scope anchor makes insertItem throw; it must not escape into a render.
    const child = base.items.find((c) => c.parentId != null)!
    expect(() =>
      commitEdit(base, { kind: 'new', afterId: child.id, beforeId: null, parentId: null }, 'x'),
    ).not.toThrow()
  })
})
