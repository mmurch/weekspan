import type { ArchiveFile, Item, Ledger } from './types.js'
import { AGENT_WARNING, SCHEMA_VERSION } from './types.js'
import { serialize, serializeArchive, SCHEMA_URI } from './serialize.js'
import { parse, parseArchive, ParseError, FutureVersionError } from './parse.js'

const header = { $schema: SCHEMA_URI, $agent: AGENT_WARNING, version: SCHEMA_VERSION }

// ---------------------------------------------------------------------------
// Round-trip fixtures.
//
// Arrays (items / vacationDays / projects) must already be in the order
// `serialize` would produce (rank / date / id ascending) — parse does not
// re-sort, it reads the file's order as-is, so an out-of-order fixture would
// come back reordered and legitimately fail deep-equality. Marks are a plain
// object, so key order doesn't matter for `toEqual`.
// ---------------------------------------------------------------------------

interface LedgerFixtures {
  empty: Ledger
  noMarks: Ledger
  manyMarks: Ledger
  nestedItems: Ledger
  recurringItems: Ledger
  nullVsAbsentOptionals: Ledger
}

function ledgerFixtures(): LedgerFixtures {
  return {
    empty: {
      ...header,
      closedThrough: null,
      vacationDays: [],
      projects: [],
      items: [],
    },

    noMarks: {
      ...header,
      closedThrough: null,
      vacationDays: [],
      projects: [{ id: 'proj-1', name: 'Home', colorToken: 'barA' }],
      items: [
        { id: 'i1', title: 'Buy milk', rank: 'aV', marks: {} },
        { id: 'i2', title: 'Call plumber', rank: 'am', marks: {} },
      ],
    },

    manyMarks: {
      ...header,
      closedThrough: '2026-W30',
      vacationDays: ['2026-07-04', '2026-12-25'],
      projects: [],
      items: [
        {
          id: 'i1',
          title: 'Water plants',
          rank: 'aV',
          marks: {
            '2026-08-17': { kind: 'due' },
            '2026-08-18': { kind: 'done' },
            '2026-08-24': { kind: 'skip', provenance: 'deliberate' },
            '2026-08-31': { kind: 'skip', provenance: 'auto' },
          },
        },
      ],
    },

    nestedItems: {
      ...header,
      closedThrough: null,
      vacationDays: [],
      projects: [],
      items: [
        { id: 'parent', title: 'Trip planning', rank: 'aV', marks: {}, parentId: null },
        { id: 'child', title: 'Book flights', rank: 'am', marks: {}, parentId: 'parent' },
      ],
    },

    recurringItems: {
      ...header,
      closedThrough: null,
      vacationDays: [],
      projects: [],
      items: [
        {
          id: 'weekly',
          title: 'Standup notes',
          rank: 'aV',
          marks: {},
          recurrence: { freq: 'weekly', weekday: 1, anchor: '2026-01-05' },
        },
        {
          id: 'biweekly',
          title: 'Pay rent',
          rank: 'am',
          marks: {},
          recurrence: { freq: 'biweekly', weekday: 5, anchor: '2026-01-02', until: '2026-12-31' },
        },
        {
          id: 'monthly',
          title: 'Pay credit card',
          rank: 'az',
          marks: {},
          recurrence: { freq: 'monthly', monthday: 15, anchor: '2026-01-15' },
        },
      ],
    },

    nullVsAbsentOptionals: {
      ...header,
      closedThrough: null,
      vacationDays: [],
      projects: [{ id: 'p1', name: 'Proj', colorToken: 'barA' }],
      items: [
        // Every optional field explicitly present and null.
        {
          id: 'a',
          title: 'Explicit nulls',
          rank: 'aV',
          marks: {},
          parentId: null,
          projectId: null,
          recurrence: null,
        },
        // Every optional field entirely absent.
        {
          id: 'b',
          title: 'Absent optionals',
          rank: 'am',
          marks: {},
        },
        // A mix: real values.
        {
          id: 'c',
          title: 'Real values',
          rank: 'az',
          marks: {},
          notes: '- one\n- two',
          projectId: 'p1',
          links: [
            { url: 'https://example.com', title: 'Example' },
            { url: 'https://example.com/x', title: 'Example X', kind: 'article' },
          ],
        },
      ],
    },
  }
}

describe('round-trip: parse(serialize(x)) deep-equals x', () => {
  const fixtures = ledgerFixtures()
  for (const [name, ledger] of Object.entries(fixtures)) {
    it(name, () => {
      const roundTripped = parse(serialize(ledger))
      expect(roundTripped).toEqual(ledger)
    })
  }
})

describe('stability: serialize(parse(serialize(x))) === serialize(x)', () => {
  const fixtures = ledgerFixtures()
  for (const [name, ledger] of Object.entries(fixtures)) {
    it(name, () => {
      const once = serialize(ledger)
      const twice = serialize(parse(once))
      expect(twice).toBe(once)
    })
  }
})

describe('archive round-trip', () => {
  it('parses back what it serialized', () => {
    const archive: ArchiveFile = {
      version: SCHEMA_VERSION,
      week: '2026-W30',
      items: [
        { id: 'i1', title: 'Done thing', rank: 'aV', marks: { '2026-07-20': { kind: 'done' } } },
        { id: 'i2', title: 'Also done', rank: 'am', marks: { '2026-07-21': { kind: 'done' } } },
      ],
    }
    expect(parseArchive(serializeArchive(archive))).toEqual(archive)
    expect(serializeArchive(parseArchive(serializeArchive(archive)))).toBe(serializeArchive(archive))
  })
})

describe('parse — rejections', () => {
  const base = () => JSON.parse(serialize(ledgerFixtures().noMarks))

  it('rejects unknown/extra keys at the root', () => {
    const raw = { ...base(), bogus: true }
    expect(() => parse(JSON.stringify(raw))).toThrow(ParseError)
    expect(() => parse(JSON.stringify(raw))).toThrow(/unknown key "bogus"/)
  })

  it('rejects unknown/extra keys on a nested object (item)', () => {
    const raw = base()
    raw.items[0].bogus = true
    expect(() => parse(JSON.stringify(raw))).toThrow(/items\[0\]: unknown key "bogus"/)
  })

  it('throws FutureVersionError when version exceeds SCHEMA_VERSION', () => {
    const raw = { ...base(), version: SCHEMA_VERSION + 1 }
    expect(() => parse(JSON.stringify(raw))).toThrow(FutureVersionError)
  })

  it('rejects an invalid IsoDate (vacationDays entry)', () => {
    const raw = { ...base(), vacationDays: ['2026-02-30'] }
    expect(() => parse(JSON.stringify(raw))).toThrow(/vacationDays\[0\]: invalid IsoDate/)
  })

  it('rejects an invalid IsoWeek (closedThrough)', () => {
    const raw = { ...base(), closedThrough: '2026-W99' }
    expect(() => parse(JSON.stringify(raw))).toThrow(/closedThrough: invalid IsoWeek/)
  })

  it('rejects an invalid mark kind', () => {
    const raw = base()
    raw.items[0].marks['2026-08-20'] = { kind: 'maybe' }
    expect(() => parse(JSON.stringify(raw))).toThrow(/kind: expected one of/)
  })

  it('rejects provenance present when kind is not skip', () => {
    const raw = base()
    raw.items[0].marks['2026-08-20'] = { kind: 'due', provenance: 'deliberate' }
    expect(() => parse(JSON.stringify(raw))).toThrow(/provenance: must not be present unless kind is "skip"/)
  })

  it('rejects an invalid recurrence freq', () => {
    const raw = base()
    raw.items[0].recurrence = { freq: 'daily', anchor: '2026-01-05' }
    expect(() => parse(JSON.stringify(raw))).toThrow(/freq: expected one of/)
  })

  it('rejects duplicate item ids', () => {
    const raw = base()
    raw.items[1].id = raw.items[0].id
    expect(() => parse(JSON.stringify(raw))).toThrow(/duplicate item id/)
  })

  it('rejects a parentId that does not resolve to an existing item', () => {
    const raw = base()
    raw.items[0].parentId = 'no-such-item'
    expect(() => parse(JSON.stringify(raw))).toThrow(/parentId: no item with id "no-such-item"/)
  })

  it('rejects nesting deeper than one level', () => {
    const raw = base()
    raw.items[0].id = 'grandparent'
    raw.items[1].id = 'parent'
    raw.items[1].parentId = 'grandparent'
    raw.items.push({ id: 'grandchild', title: 'too deep', rank: 'az', marks: {}, parentId: 'parent' })
    expect(() => parse(JSON.stringify(raw))).toThrow(/is itself nested/)
  })

  it('rejects a missing required field with no silent default', () => {
    const raw = base()
    delete raw.items[0].rank
    expect(() => parse(JSON.stringify(raw))).toThrow(/items\[0\]\.rank: required field missing/)
  })

  it('rejects malformed JSON outright', () => {
    expect(() => parse('{not json')).toThrow(ParseError)
  })
})

describe('referential and format checks added at the parse boundary', () => {
  function ledgerText(over: Record<string, unknown>): string {
    return JSON.stringify({
      version: 1,
      closedThrough: null,
      vacationDays: [],
      projects: [],
      items: [],
      ...over,
    })
  }

  it('rejects a rank that violates the never-end-in-zero invariant', () => {
    // "a0" looks plausible but nothing can ever sort between it and "a".
    const text = ledgerText({
      items: [{ id: 'x', title: 'x', rank: 'a0', marks: {} }],
    })
    expect(() => parse(text)).toThrow(/items\[0\]\.rank/)
  })

  it('rejects a rank using characters outside the base62 alphabet', () => {
    const text = ledgerText({
      items: [{ id: 'x', title: 'x', rank: 'a-b', marks: {} }],
    })
    expect(() => parse(text)).toThrow(/not a valid rank key/)
  })

  it('accepts a well-formed rank', () => {
    const text = ledgerText({
      items: [{ id: 'x', title: 'x', rank: 'aV', marks: {} }],
    })
    expect(parse(text).items[0]!.rank).toBe('aV')
  })

  it('rejects a projectId that resolves to no project', () => {
    const text = ledgerText({
      projects: [{ id: 'p1', name: 'Work', colorToken: 'barA' }],
      items: [{ id: 'x', title: 'x', rank: 'aV', marks: {}, projectId: 'nope' }],
    })
    expect(() => parse(text)).toThrow(/items\[0\]\.projectId/)
  })

  it('accepts a projectId that resolves, and a null one', () => {
    const text = ledgerText({
      projects: [{ id: 'p1', name: 'Work', colorToken: 'barA' }],
      items: [
        { id: 'x', title: 'x', rank: 'aV', marks: {}, projectId: 'p1' },
        { id: 'y', title: 'y', rank: 'am', marks: {}, projectId: null },
      ],
    })
    expect(() => parse(text)).not.toThrow()
  })
})

describe('skip provenance is required by the file format', () => {
  function withMark(mark: unknown): string {
    return JSON.stringify({
      version: 1,
      closedThrough: null,
      vacationDays: [],
      projects: [],
      items: [{ id: 'x', title: 'x', rank: 'aV', marks: { '2026-08-26': mark } }],
    })
  }

  it('rejects a skip with no provenance rather than defaulting one', () => {
    // Defaulting would be worse than rejecting: a skip silently marked
    // "deliberate" makes an absence look like avoidance, and the skip-streak
    // feature provenance exists for would report it as such.
    expect(() => parse(withMark({ kind: 'skip' }))).toThrow(/provenance/)
  })

  it('accepts both provenance values', () => {
    for (const provenance of ['deliberate', 'auto']) {
      const parsed = parse(withMark({ kind: 'skip', provenance }))
      const mark = parsed.items[0]!.marks['2026-08-26']!
      expect(mark.kind).toBe('skip')
      expect(mark.kind === 'skip' && mark.provenance).toBe(provenance)
    }
  })

  it('still rejects provenance on a non-skip mark', () => {
    expect(() => parse(withMark({ kind: 'due', provenance: 'deliberate' }))).toThrow(/provenance/)
  })

  it('accepts due and done without provenance', () => {
    expect(() => parse(withMark({ kind: 'due' }))).not.toThrow()
    expect(() => parse(withMark({ kind: 'done' }))).not.toThrow()
  })
})
