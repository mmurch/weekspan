import type { IsoDate, Project, Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan, orderItems, rankSequence } from '@weekspan/weekspan-core'
import { commitBulk, parseBulk, type BulkParse } from './bulkCapture.js'

const today: IsoDate = '2026-08-26' // Wednesday

const projects: Project[] = [
  { id: 'proj-weymouth', name: 'Weymouth ground floor', colorToken: 'barA' },
  { id: 'proj-work', name: 'Work', colorToken: 'barB' },
]

function weekspanWith(rootTitles: string[]): Weekspan {
  const ranks = rankSequence(rootTitles.length)
  return createWeekspan({
    items: rootTitles.map((title, i) => ({
      id: `root-${i}`,
      title,
      rank: ranks[i]!,
      marks: {},
    })),
  })
}

describe('parseBulk', () => {
  it('produces one line per pasted line, titles in paste order', () => {
    const parse = parseBulk('buy milk\nwalk dog\ncall mom', projects, today)
    expect(parse.lines.map((l) => l.title)).toEqual(['buy milk', 'walk dog', 'call mom'])
    expect(parse.createCount).toBe(3)
    expect(parse.lines.every((l) => !l.skipped)).toBe(true)
  })

  it('resolves due dates and projects per line via parseCapture', () => {
    const parse = parseBulk('call plumber thu\norder tiles weymouth\nplain task', projects, today)

    expect(parse.lines[0]!.title).toBe('call plumber')
    expect(parse.lines[0]!.due).toBe('2026-08-27')
    expect(parse.lines[0]!.projectId).toBeUndefined()

    expect(parse.lines[1]!.title).toBe('order tiles')
    expect(parse.lines[1]!.projectId).toBe('proj-weymouth')
    expect(parse.lines[1]!.due).toBeUndefined()

    expect(parse.lines[2]!.title).toBe('plain task')
    expect(parse.lines[2]!.due).toBeUndefined()
    expect(parse.lines[2]!.projectId).toBeUndefined()
  })

  it('does not let a due-word or project on one line leak into another', () => {
    // If the whole blob were fed to parseCapture at once (rather than
    // per-line), "thu" here would resolve a due date for a completely
    // different line. It must not.
    const parse = parseBulk('thu\nbuy milk', projects, today)
    expect(parse.lines[1]!.due).toBeUndefined()
  })

  it('skips blank and whitespace-only lines, and the count reconciles', () => {
    const parse = parseBulk('buy milk\n\n   \nwalk dog', projects, today)

    expect(parse.lines).toHaveLength(4)
    expect(parse.lines[1]!.skipped).toBe(true)
    expect(parse.lines[1]!.reason).toBe('blank line')
    expect(parse.lines[2]!.skipped).toBe(true)
    expect(parse.lines[2]!.reason).toBe('blank line')
    expect(parse.createCount).toBe(2)
    // The count reconciles: every line is accounted for as created or skipped.
    expect(parse.lines.filter((l) => l.skipped).length + parse.createCount).toBe(parse.lines.length)
  })

  it('takes the first column of a TSV-pasted line and flags extra columns', () => {
    const parse = parseBulk('buy milk\tdone\tcol3\nwalk dog', projects, today)

    expect(parse.lines[0]!.title).toBe('buy milk')
    expect(parse.lines[0]!.skipped).toBe(false)
    expect(parse.lines[0]!.reason).toContain('extra columns')

    // No tabs at all: nothing to flag.
    expect(parse.lines[1]!.title).toBe('walk dog')
    expect(parse.lines[1]!.reason).toBeUndefined()
  })

  it('does not flag a line whose extra columns are all empty', () => {
    const parse = parseBulk('buy milk\t\t', projects, today)
    expect(parse.lines[0]!.title).toBe('buy milk')
    expect(parse.lines[0]!.reason).toBeUndefined()
  })

  it('falls back to the first non-empty column when the first column is blank', () => {
    const parse = parseBulk('\tbuy milk', projects, today)
    expect(parse.lines[0]!.skipped).toBe(false)
    expect(parse.lines[0]!.title).toBe('buy milk')
  })

  it('strips common list markers from the start of a line', () => {
    const parse = parseBulk(
      '- buy milk\n* walk dog\n1. call mom\n[ ] pay bill\n[x] send email',
      projects,
      today,
    )
    expect(parse.lines.map((l) => l.title)).toEqual([
      'buy milk',
      'walk dog',
      'call mom',
      'pay bill',
      'send email',
    ])
  })

  it('strips a stacked marker like markdown task-list syntax', () => {
    const parse = parseBulk('- [ ] buy milk', projects, today)
    expect(parse.lines[0]!.title).toBe('buy milk')
  })

  it('treats a line that is only a marker as blank', () => {
    const parse = parseBulk('- \nbuy milk', projects, today)
    expect(parse.lines[0]!.skipped).toBe(true)
    expect(parse.lines[0]!.reason).toBe('blank line')
  })

  it('allows a title repeated earlier in the same paste through with no warning at all', () => {
    // Duplicates are not a mistake — "call plumber" can legitimately appear
    // on two different days in a migrated list. No flag, no dedupe.
    const parse = parseBulk('buy milk\nwalk dog\nBuy Milk', projects, today)

    expect(parse.lines[2]!.skipped).toBe(false)
    expect(parse.lines[2]!.title).toBe('Buy Milk')
    expect(parse.lines[2]!.reason).toBeUndefined()
    expect(parse.createCount).toBe(3)
  })

  it('creates every duplicate as its own item, not collapsed into one', () => {
    const w = createWeekspan()
    const parse = parseBulk('buy milk\nbuy milk\nbuy milk', projects, today)
    expect(parse.createCount).toBe(3)

    const next = commitBulk(w, parse, 'backlog')!
    expect(orderItems(next.items).map((i) => i.title)).toEqual(['buy milk', 'buy milk', 'buy milk'])
  })

  it('handles empty input as a single blank line with nothing to create', () => {
    const parse = parseBulk('', projects, today)
    expect(parse.createCount).toBe(0)
  })
})

describe('commitBulk', () => {
  it('creates all lines from an empty weekspan, in paste order', () => {
    const w = createWeekspan()
    const parse = parseBulk('buy milk\nwalk dog\ncall mom', projects, today)

    const next = commitBulk(w, parse, 'backlog')
    expect(next).not.toBeNull()
    expect(orderItems(next!.items).map((i) => i.title)).toEqual(['buy milk', 'walk dog', 'call mom'])
  })

  it('places new items at the top, before the original first root, in paste order', () => {
    const w = weekspanWith(['a', 'b'])
    const parse = parseBulk('x\ny', projects, today)

    const next = commitBulk(w, parse, 'top')!
    expect(orderItems(next.items).map((i) => i.title)).toEqual(['x', 'y', 'a', 'b'])
  })

  it('places new items in the backlog, after the original last root, in paste order', () => {
    const w = weekspanWith(['a', 'b'])
    const parse = parseBulk('x\ny', projects, today)

    const next = commitBulk(w, parse, 'backlog')!
    expect(orderItems(next.items).map((i) => i.title)).toEqual(['a', 'b', 'x', 'y'])
  })

  it('leaves every existing item rank untouched', () => {
    const w = weekspanWith(['a', 'b', 'c'])
    const before = new Map(w.items.map((i) => [i.id, i.rank]))
    const parse = parseBulk('x\ny', projects, today)

    for (const position of ['top', 'backlog'] as const) {
      const next = commitBulk(w, parse, position)!
      for (const item of next.items) {
        if (before.has(item.id)) expect(item.rank).toBe(before.get(item.id))
      }
    }
  })

  it('carries each line’s resolved due/project onto the created item', () => {
    const w = createWeekspan({ projects })
    const parse = parseBulk('call plumber thu\norder tiles weymouth', projects, today)

    const next = commitBulk(w, parse, 'top')!
    const items = orderItems(next.items)
    expect(items[0]!.marks['2026-08-27']).toEqual({ kind: 'due' })
    expect(items[1]!.projectId).toBe('proj-weymouth')
  })

  it('returns null for an empty/blank paste — nothing to create', () => {
    const w = weekspanWith(['a'])
    const parse = parseBulk('   \n\n', projects, today)
    expect(parse.createCount).toBe(0)
    expect(commitBulk(w, parse, 'top')).toBeNull()
  })

  it('skips a line that throws in insertItem and still imports the rest', () => {
    const w = createWeekspan()
    // Hand-built rather than via parseBulk: simulates a line that slipped
    // past parsing with an unusable title (insertItem trims and rejects a
    // blank/whitespace-only title), to exercise commitBulk's own defensive
    // per-line catch.
    const parse: BulkParse = {
      lines: [
        { raw: 'ok one', title: 'ok one', skipped: false },
        { raw: 'bad', title: '   ', skipped: false },
        { raw: 'ok two', title: 'ok two', skipped: false },
      ],
      createCount: 3,
    }

    const next = commitBulk(w, parse, 'backlog')!
    expect(next).not.toBeNull()
    expect(orderItems(next.items).map((i) => i.title)).toEqual(['ok one', 'ok two'])
  })

  it('imports a 200-line paste with strictly ascending, collision-free ranks', () => {
    const w = createWeekspan()
    const text = Array.from({ length: 200 }, (_, i) => `item ${i}`).join('\n')
    const parse = parseBulk(text, projects, today)
    expect(parse.createCount).toBe(200)

    const next = commitBulk(w, parse, 'top')!
    const ordered = orderItems(next.items)
    expect(ordered).toHaveLength(200)
    expect(ordered.map((i) => i.title)).toEqual(Array.from({ length: 200 }, (_, i) => `item ${i}`))

    for (let i = 0; i < ordered.length - 1; i++) {
      expect(ordered[i]!.rank < ordered[i + 1]!.rank).toBe(true)
    }
  })

  it('imports a 200-line paste into an existing list without touching existing ranks', () => {
    const w = weekspanWith(['a', 'b'])
    const before = new Map(w.items.map((i) => [i.id, i.rank]))
    const text = Array.from({ length: 200 }, (_, i) => `item ${i}`).join('\n')
    const parse = parseBulk(text, projects, today)

    const next = commitBulk(w, parse, 'backlog')!
    const ordered = orderItems(next.items)
    expect(ordered).toHaveLength(202)
    expect(ordered.slice(0, 2).map((i) => i.title)).toEqual(['a', 'b'])
    for (const item of next.items) {
      if (before.has(item.id)) expect(item.rank).toBe(before.get(item.id))
    }
  })
})
