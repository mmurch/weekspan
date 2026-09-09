import type { Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan, orderItems, rankSequence } from '@weekspan/weekspan-core'
import { reorderItem } from './reorder.js'

function weekspanWith(ids: string[]): Weekspan {
  const ranks = rankSequence(ids.length)
  return createWeekspan({
    items: ids.map((id, i) => ({ id, title: id, rank: ranks[i]!, marks: {} })),
  })
}

const order = (w: Weekspan): string[] => orderItems(w.items).map((i) => i.id)

describe('reorderItem', () => {
  it('moves a row between the two named neighbours', () => {
    const w = weekspanWith(['a', 'b', 'c'])
    expect(order(reorderItem(w, 'c', 'a', 'b')!)).toEqual(['a', 'c', 'b'])
  })

  it('moves a row to the very top with a null before-neighbour', () => {
    const w = weekspanWith(['a', 'b', 'c'])
    expect(order(reorderItem(w, 'c', null, 'a')!)).toEqual(['c', 'a', 'b'])
  })

  it('moves a row to the very end with a null after-neighbour', () => {
    const w = weekspanWith(['a', 'b', 'c'])
    expect(order(reorderItem(w, 'a', 'c', null)!)).toEqual(['b', 'c', 'a'])
  })

  it('writes nothing when the row already satisfies its neighbours', () => {
    // The whole point of routing through `minimalMoveRank`: a dragged-and-
    // returned row must leave no diff in a synced folder.
    const w = weekspanWith(['a', 'b', 'c'])
    expect(reorderItem(w, 'b', 'a', 'c')).toBeNull()
  })

  it('writes nothing for an item that is gone', () => {
    const w = weekspanWith(['a', 'b'])
    expect(reorderItem(w, 'ghost', 'a', 'b')).toBeNull()
  })

  it('does not mutate the input', () => {
    const w = weekspanWith(['a', 'b', 'c'])
    const before = w.items.map((i) => i.rank)
    reorderItem(w, 'c', 'a', 'b')
    expect(w.items.map((i) => i.rank)).toEqual(before)
  })
})
