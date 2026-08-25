import type { IsoDate } from '@weekspan/weekspan-core'
import { createWeekspan } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { buildGrid } from './viewModel.js'
import { demoWeekspan, emptyWeekspan, wrappingWeekspan } from './fixtures.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35

describe('buildGrid — window sizing', () => {
  it('yields exactly 4 week blocks when caught up (fresh weekspan, closedThrough null)', () => {
    const grid = buildGrid(emptyWeekspan(today), today)
    expect(grid.weeks).toHaveLength(4)
    expect(grid.weeks.map((w) => w.week)).toEqual(['2026-W34', '2026-W35', '2026-W36', '2026-W37'])
  })

  it('yields more than 4 week blocks when behind on close-out', () => {
    const behind = createWeekspan({ closedThrough: '2026-W30' })
    const grid = buildGrid(behind, today)
    expect(grid.weeks.length).toBeGreaterThan(4)
    expect(grid.weeks[0]!.week).toBe('2026-W31')
    expect(grid.weeks[0]!.isOldestUnclosed).toBe(true)
  })
})

describe('buildGrid — cell/date alignment', () => {
  const fixtures: Array<[string, ReturnType<typeof demoWeekspan>]> = [
    ['demo', demoWeekspan(today)],
    ['wrapping', wrappingWeekspan(today)],
    ['empty', emptyWeekspan(today)],
  ]

  for (const [name, weekspan] of fixtures) {
    it(`dates.length === weeks.length * 7 and every row's cells align, for ${name}`, () => {
      const grid = buildGrid(weekspan, today)
      expect(grid.dates).toHaveLength(grid.weeks.length * 7)
      expect(grid.totalDayColumns).toBe(grid.dates.length)

      for (const row of grid.rows) {
        expect(row.cells).toHaveLength(grid.dates.length)
        for (let i = 0; i < grid.dates.length; i++) {
          expect(row.cells[i]!.date).toBe(grid.dates[i])
        }
      }
    })
  }
})

describe('buildGrid — recurring items', () => {
  it('shows generated occurrences as due, and explicit marks as overrides', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const row = grid.rows.find((r) => r.id === 'item-water-plants')
    expect(row).toBeDefined()
    expect(row!.recurring).toBe(true)

    const cellAt = (date: IsoDate) => row!.cells[grid.dates.indexOf(date)]!

    // today: no explicit mark, rule fires (same weekday as anchor+7*n) -> generated due.
    const todayCell = cellAt(today)
    expect(todayCell.kind).toBe('due')
    expect(todayCell.generated).toBe(true)

    // today - 7: explicit done mark overrides the generated occurrence.
    const explicitDate = '2026-08-19' // today - 7
    const explicitCell = cellAt(explicitDate)
    expect(explicitCell.kind).toBe('done')
    expect(explicitCell.generated).toBe(false)

    // today + 7: no explicit mark, rule fires again -> generated due.
    const futureDate = '2026-09-02'
    const futureCell = cellAt(futureDate)
    expect(futureCell.kind).toBe('due')
    expect(futureCell.generated).toBe(true)
  })
})

describe('buildGrid — day headers', () => {
  it('uses M T W TH F for weekdays and S S for the weekend', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const currentWeek = grid.weeks.find((w) => w.isCurrent)!
    expect(currentWeek.weekdays.map((d) => d.letter)).toEqual(['M', 'T', 'W', 'TH', 'F'])
    expect(currentWeek.weekend.map((d) => d.letter)).toEqual(['S', 'S'])
  })

  it('formats a plain week range', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const w35 = grid.weeks.find((w) => w.week === '2026-W35')!
    expect(w35.range).toBe('Aug 24 – 30')
  })

  it('formats a week range spanning a month boundary', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const w36 = grid.weeks.find((w) => w.week === '2026-W36')!
    expect(w36.range).toBe('Aug 31 – Sep 6')
  })
})

describe('buildGrid — row ordering', () => {
  it('places a child row at depth 1 immediately after its parent', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const parentIndex = grid.rows.findIndex((r) => r.id === 'item-dishwasher')
    const childIndex = grid.rows.findIndex((r) => r.id === 'item-order-dishwasher')
    expect(parentIndex).toBeGreaterThanOrEqual(0)
    expect(childIndex).toBe(parentIndex + 1)
    expect(grid.rows[parentIndex]!.depth).toBe(0)
    expect(grid.rows[childIndex]!.depth).toBe(1)
  })
})

describe('buildGrid — today column', () => {
  it('marks exactly one day column as today, across the whole window', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const allColumns = grid.weeks.flatMap((w) => [...w.weekdays, ...w.weekend])
    const todayColumns = allColumns.filter((c) => c.isToday)
    expect(todayColumns).toHaveLength(1)
    expect(todayColumns[0]!.date).toBe(today)
  })
})

describe('buildGrid — vacation days', () => {
  it('flows a vacation day through to the day column and every row cell on that date', () => {
    const weekspan = demoWeekspan(today)
    const vacationDate = weekspan.vacationDays[0]!
    const grid = buildGrid(weekspan, today)

    const allColumns = grid.weeks.flatMap((w) => [...w.weekdays, ...w.weekend])
    const vacationColumn = allColumns.find((c) => c.date === vacationDate)!
    expect(vacationColumn.isVacation).toBe(true)

    const otherColumn = allColumns.find((c) => c.date !== vacationDate)!
    expect(otherColumn.isVacation).toBe(false)

    const index = grid.dates.indexOf(vacationDate)
    for (const row of grid.rows) {
      expect(row.cells[index]!.isVacation).toBe(true)
    }
    // sanity: a non-vacation date's cells are not marked vacation.
    const otherIndex = grid.dates.findIndex((d) => d !== vacationDate)
    for (const row of grid.rows) {
      expect(row.cells[otherIndex]!.isVacation).toBe(false)
    }
  })
})

describe('buildGrid — a recurring rule firing on a vacation day', () => {
  // Weekly on Mondays. 2026-08-24 is the Monday of the current week.
  const MONDAY: IsoDate = '2026-08-24'

  function withPlants(vacationDays: IsoDate[]) {
    return createWeekspan({
      vacationDays,
      items: [
        {
          id: 'plants',
          title: 'water the plants',
          rank: 'a0',
          marks: {},
          recurrence: { freq: 'weekly', weekday: 1, anchor: '2026-01-05' },
        },
      ],
    })
  }

  function plantsCellAt(vacationDays: IsoDate[], date: IsoDate) {
    const grid = buildGrid(withPlants(vacationDays), today)
    const row = grid.rows.find((r) => r.id === 'plants')!
    return row.cells[grid.dates.indexOf(date)]!
  }

  it('paints the cell as vacation with no due chip, instead of a generated due', () => {
    expect(plantsCellAt([], MONDAY)).toMatchObject({ kind: 'due', generated: true })
    // Hatched, but empty — the design's "vacation cells refuse due dates".
    expect(plantsCellAt([MONDAY], MONDAY)).toMatchObject({
      kind: null,
      generated: false,
      isVacation: true,
    })
  })

  it('leaves the following week\'s occurrence exactly where the rule puts it', () => {
    // Suppression is not a shift: nothing moves to Tuesday, and next Monday is normal.
    expect(plantsCellAt([MONDAY], '2026-08-25')).toMatchObject({ kind: null })
    expect(plantsCellAt([MONDAY], '2026-08-31')).toMatchObject({ kind: 'due', generated: true })
  })
})
