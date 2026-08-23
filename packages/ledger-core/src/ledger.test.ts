import { SCHEMA_VERSION } from './types.js'
import { createArchive, createLedger } from './ledger.js'
import { parse, parseArchive } from './parse.js'
import { serialize, serializeArchive } from './serialize.js'

describe('createLedger', () => {
  it('stamps SCHEMA_VERSION and sensible empty defaults when called with no arguments', () => {
    const ledger = createLedger()
    expect(ledger.version).toBe(SCHEMA_VERSION)
    expect(ledger.closedThrough).toBeNull()
    expect(ledger.vacationDays).toEqual([])
    expect(ledger.projects).toEqual([])
    expect(ledger.items).toEqual([])
  })

  it('accepts partial overrides for projects, items, vacationDays, and closedThrough', () => {
    const ledger = createLedger({
      closedThrough: '2026-W30',
      vacationDays: ['2026-12-25'],
      projects: [{ id: 'p1', name: 'Proj', colorToken: 'barA' }],
      items: [{ id: 'i1', title: 'Item', rank: 'a', marks: {} }],
    })
    expect(ledger.version).toBe(SCHEMA_VERSION)
    expect(ledger.closedThrough).toBe('2026-W30')
    expect(ledger.vacationDays).toEqual(['2026-12-25'])
    expect(ledger.projects).toHaveLength(1)
    expect(ledger.items).toHaveLength(1)
  })

  it('round-trips cleanly through serialize/parse', () => {
    const ledger = createLedger({ vacationDays: ['2026-07-04'] })
    const parsed = parse(serialize(ledger))
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
