import type { Item, Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan } from '@weekspan/weekspan-core'
import { EXIT } from './exit.js'
import { resolveItem } from './resolve.js'

function item(id: string, title: string, rank: string): Item {
  return { id, title, rank, marks: {} }
}

const weekspan: Weekspan = createWeekspan({
  items: [
    item('k3f9', 'choose stick-on tiles for kitchen', 'aV'),
    item('m2b1', 'choose paint color for front room', 'am'),
    item('p8x2', 'send Q3 roadmap draft to Priya', 'az'),
  ],
})

describe('resolveItem', () => {
  it('matches an exact id first', () => {
    expect(resolveItem(weekspan, 'k3f9').id).toBe('k3f9')
  })

  it('matches a unique title prefix, case-insensitively', () => {
    expect(resolveItem(weekspan, 'send Q3').id).toBe('p8x2')
    expect(resolveItem(weekspan, 'SEND q3').id).toBe('p8x2')
  })

  it('falls back to a substring match when no prefix matches', () => {
    expect(resolveItem(weekspan, 'Priya').id).toBe('p8x2')
  })

  it('refuses an ambiguous query instead of guessing', () => {
    // Both "choose ..." items match. Picking one would silently act on the wrong task.
    const err = (() => {
      try {
        resolveItem(weekspan, 'choose')
        return null
      } catch (e) {
        return e as { code: number; message: string }
      }
    })()
    expect(err?.code).toBe(EXIT.USAGE)
    expect(err?.message).toMatch(/matches 2 items/)
    expect(err?.message).toContain('k3f9')
    expect(err?.message).toContain('m2b1')
  })

  it('prefers a prefix match over a substring match', () => {
    const l = createWeekspan({
      items: [item('a1', 'roadmap review', 'aV'), item('b2', 'send roadmap draft', 'am')],
    })
    expect(resolveItem(l, 'roadmap').id).toBe('a1')
  })

  it('errors when nothing matches, and when given nothing', () => {
    expect(() => resolveItem(weekspan, 'nonexistent')).toThrow(/No item matching/)
    expect(() => resolveItem(weekspan, '   ')).toThrow(/No item given/)
  })
})
