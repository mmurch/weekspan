import type { IsoDate, Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan, rankSequence } from '@weekspan/weekspan-core'
import { dateForX, moveMark, type ColumnBox } from './markDrag.js'

const MON: IsoDate = '2026-08-24'
const TUE: IsoDate = '2026-08-25'
const WED: IsoDate = '2026-08-26'
const THU: IsoDate = '2026-08-27'

/** Four 38px columns starting at x=100, the grid's real weekday geometry. */
const columns: ColumnBox[] = [MON, TUE, WED, THU].map((date, i) => ({
  date,
  left: 100 + i * 38,
  width: 38,
}))

describe('dateForX', () => {
  it('picks the column the pointer is inside', () => {
    expect(dateForX(columns, 100)).toBe(MON)
    expect(dateForX(columns, 137)).toBe(MON)
    expect(dateForX(columns, 138)).toBe(TUE)
    expect(dateForX(columns, 213)).toBe(WED)
  })

  it('is half-open: the right edge belongs to the NEXT column, never both', () => {
    // Every x in the covered span resolves to exactly one date, with no gap
    // and no overlap — a shared boundary pixel would make the preview flicker
    // between two days.
    for (let x = 100; x < 252; x++) {
      const at = dateForX(columns, x)
      expect(at).not.toBeNull()
    }
    expect(dateForX(columns, 175)).toBe(TUE) // last px of Tue (138..175)
    expect(dateForX(columns, 176)).toBe(WED) // first px of Wed
  })

  it('snaps to the nearest column when the pointer leaves the grid', () => {
    // Dragging off either end must keep tracking the last day rather than
    // going dead — the grid scrolls horizontally and this is easy to reach.
    expect(dateForX(columns, -500)).toBe(MON)
    expect(dateForX(columns, 99)).toBe(MON)
    expect(dateForX(columns, 5000)).toBe(THU)
  })

  it('returns null when there are no columns at all', () => {
    expect(dateForX([], 120)).toBeNull()
  })
})

function weekspanWith(
  items: Array<{ id: string; marks?: Weekspan['items'][number]['marks'] }>,
  vacationDays: IsoDate[] = [],
): Weekspan {
  const ranks = rankSequence(items.length)
  return createWeekspan({
    vacationDays,
    items: items.map((it, i) => ({
      id: it.id,
      title: it.id,
      rank: ranks[i]!,
      marks: it.marks ?? {},
    })),
  })
}

describe('moveMark', () => {
  it('moves a due mark to the dropped-on day and leaves the origin empty', () => {
    const w = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'due' } } }])
    const next = moveMark(w, 'a', WED, THU)!

    expect(next.items[0]!.marks).toEqual({ [THU]: { kind: 'due' } })
    // The input is never mutated — every write path in this app relies on that.
    expect(w.items[0]!.marks).toEqual({ [WED]: { kind: 'due' } })
  })

  it('preserves the mark kind: a done stays done', () => {
    const w = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'done' } } }])
    expect(moveMark(w, 'a', WED, MON)!.items[0]!.marks).toEqual({ [MON]: { kind: 'done' } })
  })

  it('preserves skip provenance — a deliberate skip that moved is still deliberate', () => {
    const w = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'skip', provenance: 'deliberate' } } }])
    expect(moveMark(w, 'a', WED, THU)!.items[0]!.marks).toEqual({
      [THU]: { kind: 'skip', provenance: 'deliberate' },
    })
  })

  it('replaces whatever mark already sat on the destination', () => {
    // At most one mark lives at an (item, date), so a move is a clear-then-set.
    const w = weekspanWith([
      { id: 'a', marks: { [WED]: { kind: 'due' }, [THU]: { kind: 'done' } } },
    ])
    expect(moveMark(w, 'a', WED, THU)!.items[0]!.marks).toEqual({ [THU]: { kind: 'due' } })
  })

  it('touches only the dragged item', () => {
    const w = weekspanWith([
      { id: 'a', marks: { [WED]: { kind: 'due' } } },
      { id: 'b', marks: { [WED]: { kind: 'due' } } },
    ])
    const next = moveMark(w, 'a', WED, THU)!
    expect(next.items[1]!.marks).toEqual({ [WED]: { kind: 'due' } })
    expect(next.items[1]).toBe(w.items[1]) // untouched by reference, so no needless re-render
  })

  it('writes nothing when the chip did not change day', () => {
    const w = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'due' } } }])
    expect(moveMark(w, 'a', WED, WED)).toBeNull()
  })

  it('writes nothing when there is no explicit mark to move', () => {
    // A chip drawn from a recurrence rule has no stored mark; inventing one at
    // the destination would silently convert the rule into a fixed date.
    const w = weekspanWith([{ id: 'a' }])
    expect(moveMark(w, 'a', WED, THU)).toBeNull()
  })

  it('writes nothing when the item is gone', () => {
    const w = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'due' } } }])
    expect(moveMark(w, 'ghost', WED, THU)).toBeNull()
  })

  it('refuses to drop a due or a done onto a vacation day', () => {
    // The same refusal `applyMark` makes for the keyboard and the cell menu.
    const due = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'due' } } }], [THU])
    expect(moveMark(due, 'a', WED, THU)).toBeNull()

    const done = weekspanWith([{ id: 'a', marks: { [WED]: { kind: 'done' } } }], [THU])
    expect(moveMark(done, 'a', WED, THU)).toBeNull()
  })

  it('allows a skip onto a vacation day', () => {
    const w = weekspanWith(
      [{ id: 'a', marks: { [WED]: { kind: 'skip', provenance: 'deliberate' } } }],
      [THU],
    )
    expect(moveMark(w, 'a', WED, THU)!.items[0]!.marks[THU]).toEqual({
      kind: 'skip',
      provenance: 'deliberate',
    })
  })
})
