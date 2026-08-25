import type { IsoDate } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import type { RowVM } from '../grid/viewModel.js'
import { buildGrid } from '../grid/viewModel.js'
import { demoWeekspan } from '../grid/fixtures.js'
import { buildProjectView } from '../grid/projectView.js'
import { filterProjectRows, filterRows, matchesFilter, parseFilter, type FilterQuery } from './filter.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35

const grid = buildGrid(demoWeekspan(today), today)
const rows = grid.rows
// Keyed by project ID, not colour token. RowVM now carries projectId, so the
// filter identifies a project exactly rather than via its colour — two projects
// sharing a colour would otherwise be conflated, and nothing enforces uniqueness.
const projectNameById = new Map(demoWeekspan(today).projects.map((p) => [p.id, p.name]))

function rowById(id: string): RowVM {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`fixture row ${id} not found`)
  return row
}

/** A bare-bones RowVM for unit tests that don't need a real grid. */
function makeRow(overrides: Partial<RowVM> & { id: string }): RowVM {
  return {
    title: '',
    depth: 0,
    state: 'open',
    projectId: null,
    style: { strikethrough: false, italic: false, deemphasized: false },
    projectColorToken: null,
    recurring: false,
    links: [],
    cells: [],
    ...overrides,
  }
}

describe('parseFilter', () => {
  it('parses an empty (or whitespace-only) string to a query matching everything', () => {
    expect(parseFilter('')).toEqual<FilterQuery>({ text: '' })
    expect(parseFilter('   ')).toEqual<FilterQuery>({ text: '' })
  })

  it('recognizes project:, is:open, is:done, is:skipped, is:recurring', () => {
    expect(parseFilter('project:work')).toEqual<FilterQuery>({ text: '', project: 'work' })
    expect(parseFilter('is:open')).toEqual<FilterQuery>({ text: '', state: 'open' })
    expect(parseFilter('is:done')).toEqual<FilterQuery>({ text: '', state: 'done' })
    expect(parseFilter('is:skipped')).toEqual<FilterQuery>({ text: '', state: 'skipped' })
    expect(parseFilter('is:recurring')).toEqual<FilterQuery>({ text: '', recurring: true })
  })

  it('is case-insensitive on keys and is: values', () => {
    expect(parseFilter('IS:OPEN')).toEqual<FilterQuery>({ text: '', state: 'open' })
    expect(parseFilter('Project:Kitchen').project).toBe('Kitchen')
  })

  it('combines multiple tokens (structured + text) into one ANDed query', () => {
    expect(parseFilter('project:work is:open urgent')).toEqual<FilterQuery>({
      text: 'urgent',
      project: 'work',
      state: 'open',
    })
  })

  it('degrades an unknown key:value token to a plain-text term instead of an always-false filter', () => {
    const query = parseFilter('foo:bar')
    expect(query).toEqual<FilterQuery>({ text: 'foo:bar' })

    const hit = makeRow({ id: 'a', title: 'this contains foo:bar right here' })
    const miss = makeRow({ id: 'b', title: 'unrelated title' })
    expect(matchesFilter(hit, query, new Map())).toBe(true)
    expect(matchesFilter(miss, query, new Map())).toBe(false)
  })
})

describe('matchesFilter — plain text', () => {
  it('matches the title, case-insensitively, on substring', () => {
    const row = rowById('item-tiles')
    expect(matchesFilter(row, parseFilter('TILES'), projectNameById)).toBe(true)
    expect(matchesFilter(row, parseFilter('nonexistentword'), projectNameById)).toBe(false)
  })

  it('matches notes, case-insensitively, on substring', () => {
    const row = rowById('item-tiles') // notes: "- oak-look, budget under $3/tile\n..."
    expect(matchesFilter(row, parseFilter('OAK-LOOK'), projectNameById)).toBe(true)
  })
})

describe('matchesFilter — structured tokens', () => {
  it('project: filters by the row\'s resolved project name', () => {
    const kitchenRow = rowById('item-tiles')
    const workRow = rowById('item-roadmap')
    const query = parseFilter('project:kitchen')
    expect(matchesFilter(kitchenRow, query, projectNameById)).toBe(true)
    expect(matchesFilter(workRow, query, projectNameById)).toBe(false)
  })

  it('is:open / is:done / is:skipped filter by display state', () => {
    const openRow = rowById('item-tiles') // due tomorrow, no marks yet
    const doneRow = rowById('item-dishwasher') // setDone 3 days ago
    expect(matchesFilter(openRow, parseFilter('is:open'), projectNameById)).toBe(true)
    expect(matchesFilter(doneRow, parseFilter('is:open'), projectNameById)).toBe(false)
    expect(matchesFilter(doneRow, parseFilter('is:done'), projectNameById)).toBe(true)
    expect(matchesFilter(openRow, parseFilter('is:done'), projectNameById)).toBe(false)

    const skippedRow = makeRow({ id: 'skip-1', title: 'x', state: 'skipped' })
    expect(matchesFilter(skippedRow, parseFilter('is:skipped'), projectNameById)).toBe(true)
    expect(matchesFilter(doneRow, parseFilter('is:skipped'), projectNameById)).toBe(false)
  })

  it('is:recurring filters by the recurring flag', () => {
    const recurringRow = rowById('item-water-plants')
    const plainRow = rowById('item-tiles')
    const query = parseFilter('is:recurring')
    expect(matchesFilter(recurringRow, query, projectNameById)).toBe(true)
    expect(matchesFilter(plainRow, query, projectNameById)).toBe(false)
  })
})

describe('filterRows — basics', () => {
  it('returns everything, unchanged and in the same order, for an empty query', () => {
    const result = filterRows(rows, parseFilter(''), projectNameById)
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id))
  })

  it('returns an empty array, cleanly, when nothing matches', () => {
    const result = filterRows(rows, parseFilter('zzz-does-not-exist-zzz'), projectNameById)
    expect(result).toEqual([])
  })

  it('ANDs multiple terms together (structured + structured)', () => {
    // proj-work items that are open: roadmap and perf, NOT passport (admin) or
    // dishwasher (kitchen, finished).
    const result = filterRows(rows, parseFilter('project:work is:open'), projectNameById)
    expect(result.map((r) => r.id)).toEqual(['item-roadmap', 'item-perf'])
  })

  it('ANDs multiple plain-text terms regardless of order', () => {
    // "choose dishwasher model — quiet + counter depth" contains both words.
    const result = filterRows(rows, parseFilter('quiet dishwasher'), projectNameById)
    expect(result.map((r) => r.id)).toContain('item-dishwasher')
    expect(result.map((r) => r.id)).not.toContain('item-paint')
  })

  it('never reorders — output is always a subsequence of the input rank order', () => {
    const result = filterRows(rows, parseFilter('is:open'), projectNameById)
    const indices = result.map((r) => rows.findIndex((row) => row.id === r.id))
    const sorted = [...indices].sort((a, b) => a - b)
    expect(indices).toEqual(sorted)
    expect(new Set(indices).size).toBe(indices.length) // no duplicates either
  })
})

describe('filterRows — only matches are returned', () => {
  it('does NOT pull in a non-matching child of a matching parent', () => {
    // item-dishwasher (the parent) is `is:done`; its child is still open. The
    // child does not match, so it must not be on screen — the whole point of
    // the box is that what you see contains what you typed.
    const result = filterRows(rows, parseFilter('is:done'), projectNameById)
    const ids = result.map((r) => r.id)
    expect(ids).toContain('item-dishwasher')
    expect(ids).not.toContain('item-order-dishwasher')
  })

  it('does NOT pull in a non-matching parent of a matching child', () => {
    // Only the child's title contains "order"; the parent's does not.
    const result = filterRows(rows, parseFilter('order'), projectNameById)
    const ids = result.map((r) => r.id)
    expect(ids).toContain('item-order-dishwasher')
    expect(ids).not.toContain('item-dishwasher')
  })

  it('every returned row genuinely matches the query', () => {
    // The invariant the old context-widening broke, stated directly.
    for (const q of ['order', 'is:done', 'dishwasher', 'project:work', 'a']) {
      const query = parseFilter(q)
      for (const row of filterRows(rows, query, projectNameById)) {
        expect(matchesFilter(row, query, projectNameById)).toBe(true)
      }
    }
  })

  it('does not pull in unrelated rows that are neither a match nor adjacent context', () => {
    // "item-tiles" has notes mentioning "order samples first" so it's a
    // legitimate direct text match on its own — "item-roadmap" and
    // "item-paint" have no "order" anywhere and must stay out.
    const result = filterRows(rows, parseFilter('order'), projectNameById)
    const ids = result.map((r) => r.id)
    expect(ids).not.toContain('item-roadmap')
    expect(ids).not.toContain('item-paint')
  })
})

describe('filterProjectRows', () => {
  const projectRows = buildProjectView(demoWeekspan(today), today).rows
  const idsFor = (q: string) =>
    new Set(filterRows(rows, parseFilter(q), projectNameById).map((r) => r.id))

  it('keeps only the matching items', () => {
    const keep = idsFor('dishwasher')
    const out = filterProjectRows(projectRows, keep)
    const items = out.filter((r) => r.kind === 'item')
    expect(items.length).toBeGreaterThan(0)
    for (const r of items) {
      if (r.kind === 'item') expect(keep.has(r.row.id)).toBe(true)
    }
  })

  it('drops group headers left standing over nothing', () => {
    const keep = idsFor('dishwasher')
    const out = filterProjectRows(projectRows, keep)
    // Every surviving divider must be followed by at least one item before the
    // next divider — an empty group header is not a match.
    for (let i = 0; i < out.length; i++) {
      if (out[i]!.kind !== 'divider') continue
      expect(out[i + 1]).toBeDefined()
      expect(out[i + 1]!.kind).toBe('item')
    }
    // And it really did remove some — otherwise the assertion above is vacuous.
    const before = projectRows.filter((r) => r.kind === 'divider').length
    const after = out.filter((r) => r.kind === 'divider').length
    expect(after).toBeLessThan(before)
  })

  it('returns nothing at all when nothing matches — no bare headers', () => {
    expect(filterProjectRows(projectRows, new Set())).toEqual([])
  })

  it('is a subsequence — never reorders or duplicates', () => {
    const out = filterProjectRows(projectRows, idsFor('a'))
    let cursor = -1
    for (const row of out) {
      const at = projectRows.indexOf(row)
      expect(at).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('agrees with Priority view about what matched', () => {
    // Both views read the same id set, so a term can never show an item in one
    // view and hide it in the other.
    const keep = idsFor('is:open')
    const projectItems = filterProjectRows(projectRows, keep)
      .filter((r) => r.kind === 'item')
      .map((r) => (r.kind === 'item' ? r.row.id : ''))
    expect(new Set(projectItems)).toEqual(keep)
  })
})
