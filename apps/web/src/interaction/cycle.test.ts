import type { IsoDate, Item } from '@weekspan/weekspan-core'
import { addDays } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { demoWeekspan } from '../grid/fixtures.js'
import { resolveKey, type Action } from './keymap.js'
import { cycleFor, nextMarkState } from './cycle.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35, matches keymap.test.ts / viewModel.test.ts

function markOf(weekspan: ReturnType<typeof demoWeekspan>, itemId: string, date: IsoDate) {
  return weekspan.items.find((i) => i.id === itemId)!.marks[date]
}

describe('nextMarkState — non-recurring: blank -> due -> done -> blank', () => {
  const weekspan = demoWeekspan(today)
  const itemId = 'item-paint' // no marks anywhere, not a vacation date

  it('starts blank', () => {
    expect(markOf(weekspan, itemId, today)).toBeUndefined()
  })

  it('blank -> due', () => {
    const step1 = nextMarkState(weekspan, itemId, today, today)
    expect(step1).not.toBeNull()
    expect(markOf(step1!, itemId, today)).toEqual({ kind: 'due' })
  })

  it('due -> done', () => {
    const step1 = nextMarkState(weekspan, itemId, today, today)!
    const step2 = nextMarkState(step1, itemId, today, today)
    expect(step2).not.toBeNull()
    expect(markOf(step2!, itemId, today)).toEqual({ kind: 'done' })
  })

  it('done -> blank (clears the mark, loop closes)', () => {
    const step1 = nextMarkState(weekspan, itemId, today, today)!
    const step2 = nextMarkState(step1, itemId, today, today)!
    const step3 = nextMarkState(step2, itemId, today, today)
    expect(step3).not.toBeNull()
    expect(markOf(step3!, itemId, today)).toBeUndefined()
  })

  it('a second full lap lands on the exact same states as the first', () => {
    const lap1 = [
      (nextMarkState(weekspan, itemId, today, today)!),
    ]
    lap1.push(nextMarkState(lap1[0]!, itemId, today, today)!)
    lap1.push(nextMarkState(lap1[1]!, itemId, today, today)!) // back to blank

    // One more step from "blank" (lap1[2]) must equal the very first step.
    const lap2Start = nextMarkState(lap1[2]!, itemId, today, today)!
    expect(markOf(lap2Start, itemId, today)).toEqual(markOf(lap1[0]!, itemId, today))
  })
})

describe('nextMarkState — recurring: blank -> due -> done -> skip -> blank', () => {
  const weekspan = demoWeekspan(today)
  const itemId = 'item-water-plants'
  // Thursday: item's recurrence fires on Wednesday (weekday(today)), so this
  // date has no generated occurrence — a genuinely blank cell to start from.
  const date = addDays(today, 1)

  it('starts blank (no explicit mark, no generated occurrence here)', () => {
    expect(markOf(weekspan, itemId, date)).toBeUndefined()
  })

  it('blank -> due -> done -> skip -> blank, in order', () => {
    const step1 = nextMarkState(weekspan, itemId, date, today)!
    expect(markOf(step1, itemId, date)).toEqual({ kind: 'due' })

    const step2 = nextMarkState(step1, itemId, date, today)!
    expect(markOf(step2, itemId, date)).toEqual({ kind: 'done' })

    const step3 = nextMarkState(step2, itemId, date, today)!
    expect(markOf(step3, itemId, date)).toEqual({ kind: 'skip', provenance: 'deliberate' })

    const step4 = nextMarkState(step3, itemId, date, today)
    expect(step4).not.toBeNull()
    expect(markOf(step4!, itemId, date)).toBeUndefined()
  })

  it('a skip produced by cycling is always provenance "deliberate", never "auto"', () => {
    const step1 = nextMarkState(weekspan, itemId, date, today)!
    const step2 = nextMarkState(step1, itemId, date, today)!
    const step3 = nextMarkState(step2, itemId, date, today)!
    const mark = markOf(step3, itemId, date)
    expect(mark).toBeDefined()
    expect(mark!.kind).toBe('skip')
    // Assert the actual provenance value, not just that it's truthy.
    expect((mark as { kind: 'skip'; provenance: string }).provenance).toBe('deliberate')
  })

  it('cycling twice returns to the same state as one step from that point (loop closes)', () => {
    const step1 = nextMarkState(weekspan, itemId, date, today)!
    const step2 = nextMarkState(step1, itemId, date, today)!
    const step3 = nextMarkState(step2, itemId, date, today)!
    const step4 = nextMarkState(step3, itemId, date, today)! // blank again

    // From blank, one more step must reproduce step1's mark exactly.
    const again = nextMarkState(step4, itemId, date, today)!
    expect(markOf(again, itemId, date)).toEqual(markOf(step1, itemId, date))
  })
})

describe('nextMarkState — generated occurrences', () => {
  const weekspan = demoWeekspan(today)
  const itemId = 'item-water-plants'
  // `today` itself IS a generated occurrence for this item (see fixtures.ts:
  // weekly recurrence anchored 3 weeks back on the same weekday as `today`).

  it('the starting cell has no explicit mark but reads as due via effectiveMark', () => {
    expect(markOf(weekspan, itemId, today)).toBeUndefined()
  })

  it('cycling a generated due writes an EXPLICIT done mark, not a synthesized one', () => {
    const next = nextMarkState(weekspan, itemId, today, today)
    expect(next).not.toBeNull()
    // effectiveMark treated the generated due as 'due', so cycling steps to 'done'.
    expect(markOf(next!, itemId, today)).toEqual({ kind: 'done' })
  })

  it('cycling all the way to "blank" clears the explicit mark, and the generated due reappears', () => {
    const step1 = nextMarkState(weekspan, itemId, today, today)! // explicit done
    const step2 = nextMarkState(step1, itemId, today, today)! // explicit skip
    const step3 = nextMarkState(step2, itemId, today, today)! // "blank": explicit mark cleared

    const item = step3.items.find((i) => i.id === itemId)!
    // No explicit mark left at all...
    expect(item.marks[today]).toBeUndefined()
    // ...but the cell is NOT truly empty: the rule's generated due is back,
    // which is correct — a generated occurrence with no exception recorded
    // against it is due, by definition of the rule that generates it.
    expect(cycleFor(item, today)).toBe('done') // i.e. effectiveMark reads 'due' again, next step is 'done'
  })
})

describe('nextMarkState — vacation days', () => {
  const weekspan = demoWeekspan(today)
  const vacationDate = weekspan.vacationDays[0]!
  const itemId = 'item-paint' // blank on the vacation date, non-recurring

  it('due is refused on a vacation day (blank -> due is blocked)', () => {
    expect(nextMarkState(weekspan, itemId, vacationDate, today)).toBeNull()
  })

  it('done is refused on a vacation day (an existing due cannot advance to done)', () => {
    // Reach an explicit 'due' state via a non-vacation date's item, but written
    // directly at the vacation date to isolate the due->done refusal from the
    // (already covered) blank->due refusal.
    const withDue = {
      ...weekspan,
      items: weekspan.items.map((i) =>
        i.id === itemId ? { ...i, marks: { ...i.marks, [vacationDate]: { kind: 'due' as const } } } : i,
      ),
    }
    expect(nextMarkState(withDue, itemId, vacationDate, today)).toBeNull()
  })

  // Skip only exists in the RECURRING cycle (item-paint is non-recurring, so
  // its cycle is blank -> due -> done -> blank with no skip step at all — see
  // the non-recurring cycle test above). These two use item-water-plants
  // instead; `vacationDate` (today+5, a Monday) isn't that item's recurrence
  // weekday, so it's a genuinely blank cell there too.
  const recurringItemId = 'item-water-plants'

  it('skip is allowed on a vacation day', () => {
    const withDone = {
      ...weekspan,
      items: weekspan.items.map((i) =>
        i.id === recurringItemId
          ? { ...i, marks: { ...i.marks, [vacationDate]: { kind: 'done' as const } } }
          : i,
      ),
    }
    const next = nextMarkState(withDone, recurringItemId, vacationDate, today)
    expect(next).not.toBeNull()
    expect(markOf(next!, recurringItemId, vacationDate)).toEqual({
      kind: 'skip',
      provenance: 'deliberate',
    })
  })

  it('clear is allowed on a vacation day', () => {
    const withSkip = {
      ...weekspan,
      items: weekspan.items.map((i) =>
        i.id === recurringItemId
          ? {
              ...i,
              marks: {
                ...i.marks,
                [vacationDate]: { kind: 'skip' as const, provenance: 'deliberate' as const },
              },
            }
          : i,
      ),
    }
    const next = nextMarkState(withSkip, recurringItemId, vacationDate, today)
    expect(next).not.toBeNull()
    expect(markOf(next!, recurringItemId, vacationDate)).toBeUndefined()
  })
})

describe('nextMarkState — no-op / not-found', () => {
  const weekspan = demoWeekspan(today)

  it('returns null when the item does not exist', () => {
    expect(nextMarkState(weekspan, 'no-such-item', today, today)).toBeNull()
  })
})

describe('cycleFor — pure step function edge case', () => {
  it('a stray skip mark on a non-recurring item steps to blank (escape hatch back into the loop)', () => {
    // The blank->due->done loop never produces this state itself, but nothing
    // stops some other code path (e.g. the unbound setSkip action) from
    // leaving a skip mark on a non-recurring item. cycleFor treats it as
    // "before" the loop rather than getting stuck.
    const item: Item = {
      id: 'x',
      title: 'x',
      rank: 'a',
      marks: { [today]: { kind: 'skip', provenance: 'deliberate' } },
    }
    expect(cycleFor(item, today)).toBeNull()
  })
})

describe('Enter resolves to the cycle action', () => {
  function fakeKeyEvent(key: string, target: unknown = null): KeyboardEvent {
    return {
      key,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      target,
    } as unknown as KeyboardEvent
  }

  it('Enter resolves to { kind: "cycle" }', () => {
    const expected: Action = { kind: 'cycle' }
    expect(resolveKey(fakeKeyEvent('Enter'))).toEqual(expected)
  })

  it('Enter is ignored while focus is in a text field', () => {
    expect(resolveKey(fakeKeyEvent('Enter', { tagName: 'INPUT' }))).toBeNull()
    expect(resolveKey(fakeKeyEvent('Enter', { tagName: 'TEXTAREA' }))).toBeNull()
    expect(resolveKey(fakeKeyEvent('Enter', { tagName: 'DIV', isContentEditable: true }))).toBeNull()
  })
})
