import type { Ledger, Project, Item, ArchiveFile } from './types.js'
import { AGENT_WARNING, SCHEMA_VERSION } from './types.js'
import { serialize, serializeArchive, SCHEMA_URI } from './serialize.js'

function emptyLedger(): Ledger {
  return {
    version: SCHEMA_VERSION,
    closedThrough: null,
    vacationDays: [],
    projects: [],
    items: [],
  }
}

describe('serialize — header', () => {
  it('always emits $schema and $agent, forced to the canonical constants, regardless of what the in-memory ledger carries', () => {
    const ledger = emptyLedger()
    // Even if the in-memory ledger disagrees with the canonical values...
    ;(ledger as Ledger).$schema = 'something-else'
    ;(ledger as Ledger).$agent = 'do whatever you want'
    const out = JSON.parse(serialize(ledger))
    expect(out.$schema).toBe(SCHEMA_URI)
    expect(out.$agent).toBe(AGENT_WARNING)
  })

  it('writes ledger.version verbatim — never substitutes SCHEMA_VERSION', () => {
    // A ledger already at the current version serializes as that version...
    const current = { ...emptyLedger(), version: 1 }
    expect(JSON.parse(serialize(current)).version).toBe(1)

    // ...and critically, a ledger carrying a version that is NOT the current
    // constant must round-trip with ITS OWN version, not the constant. This
    // is the regression test: a version-1 fixture would pass even with the
    // old force-stamping bug (1 === SCHEMA_VERSION), so it proves nothing.
    // version 0 is deliberately not SCHEMA_VERSION (which is 1) so a
    // reintroduced `out.version = SCHEMA_VERSION` fails this assertion.
    const stale = { ...emptyLedger(), version: 0 }
    const out = JSON.parse(serialize(stale))
    expect(out.version).toBe(0)
    expect(out.version).not.toBe(SCHEMA_VERSION)
  })

  it('emits a trailing newline and 2-space indent', () => {
    const text = serialize(emptyLedger())
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(text).toContain('\n  "version"')
  })

  it('fixes key order at the top level regardless of input construction order', () => {
    const text = serialize(emptyLedger())
    const keys = Object.keys(JSON.parse(text))
    expect(keys).toEqual(['$schema', '$agent', 'version', 'closedThrough', 'vacationDays', 'projects', 'items'])
  })
})

describe('serialize — sorting', () => {
  it('sorts items by rank ascending', () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      items: [
        { id: 'c', title: 'C', rank: 'm', marks: {} },
        { id: 'a', title: 'A', rank: 'a', marks: {} },
        { id: 'b', title: 'B', rank: 'g', marks: {} },
      ],
    }
    const out = JSON.parse(serialize(ledger))
    expect(out.items.map((i: Item) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts marks keys by date ascending', () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      items: [
        {
          id: 'a',
          title: 'A',
          rank: 'a',
          marks: {
            '2026-09-01': { kind: 'skip', provenance: 'deliberate' },
            '2026-08-20': { kind: 'due' },
            '2026-08-27': { kind: 'done' },
          },
        },
      ],
    }
    const out = JSON.parse(serialize(ledger))
    expect(Object.keys(out.items[0].marks)).toEqual(['2026-08-20', '2026-08-27', '2026-09-01'])
  })

  it('sorts vacationDays ascending', () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      vacationDays: ['2026-12-25', '2026-01-01', '2026-07-04'],
    }
    const out = JSON.parse(serialize(ledger))
    expect(out.vacationDays).toEqual(['2026-01-01', '2026-07-04', '2026-12-25'])
  })

  it('sorts projects by id', () => {
    const projects: Project[] = [
      { id: 'zzz', name: 'Z', colorToken: 'barA' },
      { id: 'aaa', name: 'A', colorToken: 'barB' },
    ]
    const out = JSON.parse(serialize({ ...emptyLedger(), projects }))
    expect(out.projects.map((p: Project) => p.id)).toEqual(['aaa', 'zzz'])
  })
})

describe('serialize — optional vs nullable fields', () => {
  it('omits undefined optional fields (notes, links)', () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      items: [{ id: 'a', title: 'A', rank: 'a', marks: {} }],
    }
    const out = JSON.parse(serialize(ledger))
    expect('notes' in out.items[0]).toBe(false)
    expect('links' in out.items[0]).toBe(false)
    expect('parentId' in out.items[0]).toBe(false)
    expect('projectId' in out.items[0]).toBe(false)
    expect('recurrence' in out.items[0]).toBe(false)
  })

  it('emits explicit null for parentId, projectId, recurrence when set to null', () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      items: [
        {
          id: 'a',
          title: 'A',
          rank: 'a',
          marks: {},
          parentId: null,
          projectId: null,
          recurrence: null,
        },
      ],
    }
    const out = JSON.parse(serialize(ledger))
    expect(out.items[0].parentId).toBeNull()
    expect(out.items[0].projectId).toBeNull()
    expect(out.items[0].recurrence).toBeNull()
  })

  it('always emits closedThrough, null or a week', () => {
    const out1 = JSON.parse(serialize(emptyLedger()))
    expect(out1.closedThrough).toBeNull()
    const out2 = JSON.parse(serialize({ ...emptyLedger(), closedThrough: '2026-W34' }))
    expect(out2.closedThrough).toBe('2026-W34')
  })

  it('omits provenance on a mark unless present', () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      items: [
        {
          id: 'a',
          title: 'A',
          rank: 'a',
          marks: { '2026-08-20': { kind: 'due' } },
        },
      ],
    }
    const out = JSON.parse(serialize(ledger))
    expect('provenance' in out.items[0].marks['2026-08-20']).toBe(false)
  })
})

describe('serialize — key-order independence', () => {
  it('two logically-identical ledgers built with different field insertion order serialize identically', () => {
    const item1: Item = {
      id: 'a',
      title: 'A',
      rank: 'a',
      marks: { '2026-08-20': { kind: 'due' } },
      notes: 'hi',
      parentId: null,
    }
    // Same data, fields assigned in a different order.
    const item2 = {} as Item
    item2.parentId = null
    item2.notes = 'hi'
    item2.marks = { '2026-08-20': { kind: 'due' } }
    item2.rank = 'a'
    item2.title = 'A'
    item2.id = 'a'

    const ledgerA: Ledger = { ...emptyLedger(), items: [item1] }
    const ledgerB: Ledger = { ...emptyLedger(), items: [item2] }
    expect(serialize(ledgerA)).toBe(serialize(ledgerB))
  })
})

describe('serializeArchive', () => {
  it('emits version, week, items in that order, items sorted by rank, no $schema/$agent', () => {
    const archive: ArchiveFile = {
      version: SCHEMA_VERSION,
      week: '2026-W34',
      items: [
        { id: 'b', title: 'B', rank: 'z', marks: {} },
        { id: 'a', title: 'A', rank: 'a', marks: {} },
      ],
    }
    const text = serializeArchive(archive)
    const out = JSON.parse(text)
    expect(Object.keys(out)).toEqual(['version', 'week', 'items'])
    expect(out.items.map((i: Item) => i.id)).toEqual(['a', 'b'])
    expect(text.endsWith('\n')).toBe(true)
  })

  it('writes archive.version verbatim — never substitutes SCHEMA_VERSION', () => {
    const archive: ArchiveFile = { version: 0, week: '2026-W34', items: [] }
    const out = JSON.parse(serializeArchive(archive))
    expect(out.version).toBe(0)
    expect(out.version).not.toBe(SCHEMA_VERSION)
  })
})
