import type { Item, Mark, Recurrence } from './types.js'
import {
  displayState,
  effectiveMark,
  isArchivable,
  isFinished,
  isGeneratedOccurrence,
  rowStyle,
} from './derived.js'

function makeItem(marks: Record<string, Mark> = {}, recurrence?: Recurrence | null): Item {
  return {
    id: 'item-1',
    title: 'Test item',
    rank: 'aV',
    marks,
    ...(recurrence !== undefined ? { recurrence } : {}),
  }
}

describe('isFinished — non-recurring', () => {
  it('missed-then-completed: a stale earlier DUE does not block a later DONE', () => {
    // Planned Tue (2026-08-25), lapsed, then done Thu (2026-08-27).
    const item = makeItem({
      '2026-08-25': { kind: 'due' },
      '2026-08-27': { kind: 'done' },
    })
    expect(isFinished(item)).toBe(true)
  })

  it('chunked work in progress: done on Tue with due still set for Thu is NOT finished', () => {
    const item = makeItem({
      '2026-08-25': { kind: 'done' },
      '2026-08-27': { kind: 'due' },
    })
    expect(isFinished(item)).toBe(false)
  })

  it('skip transparency: done on Tue, skip on Thu is still finished', () => {
    const item = makeItem({
      '2026-08-25': { kind: 'done' },
      '2026-08-27': { kind: 'skip', provenance: 'deliberate' },
    })
    expect(isFinished(item)).toBe(true)
  })

  it('multiple trailing skips are all transparent', () => {
    const item = makeItem({
      '2026-08-25': { kind: 'done' },
      '2026-08-27': { kind: 'skip', provenance: 'auto' },
      '2026-08-29': { kind: 'skip', provenance: 'deliberate' },
    })
    expect(isFinished(item)).toBe(true)
  })

  it('an item with no marks at all is not finished', () => {
    const item = makeItem()
    expect(isFinished(item)).toBe(false)
  })

  it('an item with only a skip mark is not finished', () => {
    const item = makeItem({ '2026-08-25': { kind: 'skip', provenance: 'deliberate' } })
    expect(isFinished(item)).toBe(false)
  })

  it('latest mark being due (not done) is not finished', () => {
    const item = makeItem({
      '2026-08-25': { kind: 'done' },
      '2026-08-27': { kind: 'due' },
    })
    expect(isFinished(item)).toBe(false)
  })
})

describe('isFinished — recurring', () => {
  it('a recurring item with several done marks is still never finished', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' }
    const item = makeItem(
      {
        '2026-08-04': { kind: 'done' },
        '2026-08-11': { kind: 'done' },
        '2026-08-18': { kind: 'done' },
      },
      rule,
    )
    expect(isFinished(item)).toBe(false)
  })
})

describe('effectiveMark', () => {
  const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' } // Tuesdays

  it('returns a generated due mark on a rule date with no explicit mark', () => {
    const item = makeItem({}, rule)
    expect(effectiveMark(item, '2026-08-11', [])).toEqual({ kind: 'due' })
  })

  it('returns the explicit mark on a date that has one, overriding the generated occurrence', () => {
    const item = makeItem({ '2026-08-11': { kind: 'done' } }, rule)
    expect(effectiveMark(item, '2026-08-11', [])).toEqual({ kind: 'done' })
  })

  it('returns the explicit mark on a non-rule date', () => {
    const item = makeItem({ '2026-08-12': { kind: 'due' } }, rule)
    expect(effectiveMark(item, '2026-08-12', [])).toEqual({ kind: 'due' })
  })

  it('returns undefined when there is no explicit mark and no rule occurrence', () => {
    const item = makeItem({}, rule)
    expect(effectiveMark(item, '2026-08-12', [])).toBeUndefined()
  })

  it('returns undefined for a non-recurring item with no mark', () => {
    const item = makeItem()
    expect(effectiveMark(item, '2026-08-12', [])).toBeUndefined()
  })
})

describe('isGeneratedOccurrence', () => {
  const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' } // Tuesdays

  it('is true when due-ness comes only from the rule', () => {
    const item = makeItem({}, rule)
    expect(isGeneratedOccurrence(item, '2026-08-11', [])).toBe(true)
  })

  it('is false when an explicit mark exists on the rule date', () => {
    const item = makeItem({ '2026-08-11': { kind: 'done' } }, rule)
    expect(isGeneratedOccurrence(item, '2026-08-11', [])).toBe(false)
  })

  it('is false when the rule does not generate an occurrence on that date', () => {
    const item = makeItem({}, rule)
    expect(isGeneratedOccurrence(item, '2026-08-12', [])).toBe(false)
  })

  it('is false for a non-recurring item', () => {
    const item = makeItem()
    expect(isGeneratedOccurrence(item, '2026-08-12', [])).toBe(false)
  })
})

describe('vacation days suppress generated occurrences', () => {
  const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' } // Tuesdays

  it('effectiveMark shows nothing on a rule date the user marked vacation', () => {
    const item = makeItem({}, rule)
    expect(effectiveMark(item, '2026-08-11', [])).toEqual({ kind: 'due' })
    expect(effectiveMark(item, '2026-08-11', ['2026-08-11'])).toBeUndefined()
  })

  it('isGeneratedOccurrence agrees — nothing for close-out to block on', () => {
    const item = makeItem({}, rule)
    expect(isGeneratedOccurrence(item, '2026-08-11', ['2026-08-11'])).toBe(false)
  })

  it('a vacation day elsewhere in the week leaves the occurrence alone', () => {
    const item = makeItem({}, rule)
    // Away on the Monday; the Tuesday rule date is untouched.
    expect(effectiveMark(item, '2026-08-11', ['2026-08-10'])).toEqual({ kind: 'due' })
    expect(isGeneratedOccurrence(item, '2026-08-11', ['2026-08-10'])).toBe(true)
  })

  it('suppression is rendering-only: the NEXT occurrence still lands on the rule date', () => {
    // The occurrence is not pushed to the next working day. Aug 11 is hidden;
    // Aug 18 fires exactly as the weekly rule says, and Aug 12 stays blank.
    const item = makeItem({}, rule)
    const vac = ['2026-08-11']
    expect(effectiveMark(item, '2026-08-12', vac)).toBeUndefined()
    expect(effectiveMark(item, '2026-08-18', vac)).toEqual({ kind: 'due' })
  })

  it('an EXPLICIT mark on a vacation day still renders', () => {
    // Days get marked vacation after the fact. A completion the user already
    // recorded must not vanish from the grid.
    const done = makeItem({ '2026-08-11': { kind: 'done' } }, rule)
    expect(effectiveMark(done, '2026-08-11', ['2026-08-11'])).toEqual({ kind: 'done' })

    const due = makeItem({ '2026-08-11': { kind: 'due' } }, rule)
    expect(effectiveMark(due, '2026-08-11', ['2026-08-11'])).toEqual({ kind: 'due' })
    // Still not GENERATED — it has an explicit mark, which is the prior rule.
    expect(isGeneratedOccurrence(due, '2026-08-11', ['2026-08-11'])).toBe(false)
  })

  it('un-marking the vacation day restores the cell exactly — nothing was written', () => {
    const item = makeItem({}, rule)
    expect(effectiveMark(item, '2026-08-11', ['2026-08-11'])).toBeUndefined()
    expect(effectiveMark(item, '2026-08-11', [])).toEqual({ kind: 'due' })
    expect(item.marks).toEqual({})
  })

  it('does not touch a non-recurring item — vacation only suppresses synthesis', () => {
    const item = makeItem({ '2026-08-11': { kind: 'due' } })
    expect(effectiveMark(item, '2026-08-11', ['2026-08-11'])).toEqual({ kind: 'due' })
  })
})

describe('displayState — non-recurring', () => {
  it('finished when isFinished is true', () => {
    const item = makeItem({ '2026-08-25': { kind: 'done' } })
    expect(displayState(item, '2026-08-26')).toBe('finished')
  })

  it('skipped when the latest mark is a skip', () => {
    const item = makeItem({ '2026-08-25': { kind: 'skip', provenance: 'deliberate' } })
    expect(displayState(item, '2026-08-26')).toBe('skipped')
  })

  it('open when there are no marks', () => {
    const item = makeItem()
    expect(displayState(item, '2026-08-26')).toBe('open')
  })

  it('open when the latest mark is due', () => {
    const item = makeItem({ '2026-08-25': { kind: 'due' } })
    expect(displayState(item, '2026-08-26')).toBe('open')
  })
})

describe('displayState — recurring, period-relative', () => {
  it('monthly item done on the 3rd still reads finished on the 20th of the same month', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 3, anchor: '2026-01-03' }
    const item = makeItem({ '2026-08-03': { kind: 'done' } }, rule)
    expect(displayState(item, '2026-08-20')).toBe('finished')
  })

  it('the same item reads open early the next month', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 3, anchor: '2026-01-03' }
    const item = makeItem({ '2026-08-03': { kind: 'done' } }, rule)
    expect(displayState(item, '2026-09-01')).toBe('open')
  })

  it('reads skipped when the current period carries a skip and no done', () => {
    const rule: Recurrence = { freq: 'monthly', monthday: 3, anchor: '2026-01-03' }
    const item = makeItem({ '2026-08-03': { kind: 'skip', provenance: 'deliberate' } }, rule)
    expect(displayState(item, '2026-08-20')).toBe('skipped')
  })

  it('weekly item ignores a done mark from a previous period', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' }
    const item = makeItem({ '2026-08-11': { kind: 'done' } }, rule) // done last Tuesday
    expect(displayState(item, '2026-08-18')).toBe('open') // this week, nothing marked yet
  })
})

describe('isArchivable', () => {
  it('true for a finished item whose latest mark falls on the closing week end', () => {
    const item = makeItem({ '2026-08-30': { kind: 'done' } }) // Sunday of W35
    expect(isArchivable(item, '2026-08-30')).toBe(true)
  })

  it('false for a finished item whose latest mark is in the week AFTER the closing week', () => {
    // Closing week ends 2026-08-30 (Sunday of W35). This item's latest —
    // and only — mark is a done on 2026-09-01, which lands in W36. It is
    // finished, but its live cell sits past the week being closed, so
    // closing W35 must not archive it.
    const item = makeItem({ '2026-09-01': { kind: 'done' } })
    expect(isFinished(item)).toBe(true)
    expect(isArchivable(item, '2026-08-30')).toBe(false)
  })

  it('false for a finished item whose latest mark (a trailing skip) is after the closing week end', () => {
    const item = makeItem({
      '2026-08-25': { kind: 'done' },
      '2026-09-01': { kind: 'skip', provenance: 'auto' },
    })
    expect(isFinished(item)).toBe(true)
    expect(isArchivable(item, '2026-08-30')).toBe(false)
  })

  it('false for an item that is not finished', () => {
    const item = makeItem({ '2026-08-25': { kind: 'due' } })
    expect(isArchivable(item, '2026-08-30')).toBe(false)
  })

  it('false for a recurring item, even with done marks before the closing week end', () => {
    const rule: Recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-04' }
    const item = makeItem({ '2026-08-25': { kind: 'done' } }, rule)
    expect(isArchivable(item, '2026-08-30')).toBe(false)
  })

  it('false for an item with no marks', () => {
    const item = makeItem()
    expect(isArchivable(item, '2026-08-30')).toBe(false)
  })
})

describe('rowStyle', () => {
  it('finished: strikethrough, not italic, not deemphasized', () => {
    expect(rowStyle('finished')).toEqual({ strikethrough: true, italic: false, deemphasized: false })
  })

  it('skipped: italic + deemphasized, never strikethrough', () => {
    const style = rowStyle('skipped')
    expect(style.strikethrough).toBe(false)
    expect(style).toEqual({ strikethrough: false, italic: true, deemphasized: true })
  })

  it('open: no styling', () => {
    expect(rowStyle('open')).toEqual({ strikethrough: false, italic: false, deemphasized: false })
  })
})
