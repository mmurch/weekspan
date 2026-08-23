import { SCHEMA_VERSION } from './types.js'
import { createArchive, createWeekspan } from './weekspan.js'
import { parse, parseArchive } from './parse.js'
import { serialize, serializeArchive } from './serialize.js'

describe('createWeekspan', () => {
  it('stamps SCHEMA_VERSION and sensible empty defaults when called with no arguments', () => {
    const weekspan = createWeekspan()
    expect(weekspan.version).toBe(SCHEMA_VERSION)
    expect(weekspan.closedThrough).toBeNull()
    expect(weekspan.vacationDays).toEqual([])
    expect(weekspan.projects).toEqual([])
    expect(weekspan.items).toEqual([])
  })

  it('accepts partial overrides for projects, items, vacationDays, and closedThrough', () => {
    const weekspan = createWeekspan({
      closedThrough: '2026-W30',
      vacationDays: ['2026-12-25'],
      projects: [{ id: 'p1', name: 'Proj', colorToken: 'barA' }],
      items: [{ id: 'i1', title: 'Item', rank: 'a', marks: {} }],
    })
    expect(weekspan.version).toBe(SCHEMA_VERSION)
    expect(weekspan.closedThrough).toBe('2026-W30')
    expect(weekspan.vacationDays).toEqual(['2026-12-25'])
    expect(weekspan.projects).toHaveLength(1)
    expect(weekspan.items).toHaveLength(1)
  })

  it('round-trips cleanly through serialize/parse', () => {
    const weekspan = createWeekspan({ vacationDays: ['2026-07-04'] })
    const parsed = parse(serialize(weekspan))
    expect(parsed.version).toBe(SCHEMA_VERSION)
    expect(parsed.vacationDays).toEqual(['2026-07-04'])
    expect(parsed.closedThrough).toBeNull()
    expect(parsed.projects).toEqual([])
    expect(parsed.items).toEqual([])
  })
})

describe('createArchive', () => {
  it('stamps SCHEMA_VERSION and carries the given week and items', () => {
    const items = [{ id: 'i1', title: 'Item', rank: 'a', marks: {} }]
    const archive = createArchive('2026-W30', items)
    expect(archive.version).toBe(SCHEMA_VERSION)
    expect(archive.week).toBe('2026-W30')
    expect(archive.items).toEqual(items)
  })

  it('round-trips cleanly through serializeArchive/parseArchive', () => {
    const items = [{ id: 'i1', title: 'Item', rank: 'a', marks: {} }]
    const archive = createArchive('2026-W30', items)
    const parsed = parseArchive(serializeArchive(archive))
    expect(parsed.version).toBe(SCHEMA_VERSION)
    expect(parsed.week).toBe('2026-W30')
    expect(parsed.items).toEqual(items)
  })
})
