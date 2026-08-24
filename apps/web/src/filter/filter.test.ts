import type { IsoDate } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import type { RowVM } from '../grid/viewModel.js'
import { buildGrid } from '../grid/viewModel.js'
import { demoWeekspan } from '../grid/fixtures.js'
import { filterRows, matchesFilter, parseFilter, type FilterQuery } from './filter.js'

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
    expect(result.every((r) => r.contextOnly === false)).toBe(true)
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
    // "choose dishwasher model — quiet + counter depth" contains both words;
    // its child ("order dishwasher") matches neither directly but is pulled
    // in as context because its parent matched.
    const result = filterRows(rows, parseFilter('quiet dishwasher'), projectNameById)
    const dishwasher = result.find((r) => r.id === 'item-dishwasher')!
    const child = result.find((r) => r.id === 'item-order-dishwasher')
    expect(dishwasher.contextOnly).toBe(false)
    expect(child?.contextOnly).toBe(true)
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

describe('filterRows — hierarchy context', () => {
  it('a matching parent pulls its children into the result as context', () => {
    // Only item-dishwasher (the parent) is directly `is:done`; its child
    // item-order-dishwasher is still open (due in 3 days).
    const result = filterRows(rows, parseFilter('is:done'), projectNameById)
    const ids = result.map((r) => r.id)
    expect(ids).toContain('item-dishwasher')
    expect(ids).toContain('item-order-dishwasher')

    const parent = result.find((r) => r.id === 'item-dishwasher')!
    const child = result.find((r) => r.id === 'item-order-dishwasher')!
    expect(parent.contextOnly).toBe(false)
    expect(child.contextOnly).toBe(true)

    // Order preserved: parent still comes before its child.
    expect(ids.indexOf('item-dishwasher')).toBeLessThan(ids.indexOf('item-order-dishwasher'))
  })

  it('a matching child pulls its parent into the result as context', () => {
    // Only the child's title contains "order" — the parent's title
    // ("choose dishwasher model — quiet + counter depth") does not.
    const result = filterRows(rows, parseFilter('order'), projectNameById)
    const ids = result.map((r) => r.id)
    expect(ids).toContain('item-order-dishwasher')
    expect(ids).toContain('item-dishwasher')

    const parent = result.find((r) => r.id === 'item-dishwasher')!
    const child = result.find((r) => r.id === 'item-order-dishwasher')!
    expect(child.contextOnly).toBe(false)
    expect(parent.contextOnly).toBe(true)
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
