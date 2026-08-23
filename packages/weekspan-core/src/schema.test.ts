/**
 * Two jobs:
 *
 * 1. Prove `weekspan.schema.json` isn't hand-maintained-and-drifting: regenerate
 *    it from `types.ts` via the real `scripts/generate-schema.ts` (shelled
 *    out to, so this exercises the exact script `npm run generate:schema`
 *    runs — not a reimplementation of it) and assert the result deep-equals
 *    the committed file. Edit `types.ts` without regenerating and this test
 *    fails — that's the whole point of generating rather than hand-writing.
 *
 * 2. Prove the generated schema actually enforces the contract, not just
 *    that it's shaped plausibly: valid weekspans (via the real `serialize()`,
 *    so this is real on-disk output, not hand-built JSON) must pass; a
 *    handful of specific violations of the `Mark` discriminated union, the
 *    `Item` required fields, and the `IsoDate`-keyed `marks` map must fail.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import type { ValidateFunction } from 'ajv'
import type { Item, Weekspan } from './types.js'
import { SCHEMA_VERSION } from './types.js'
import { serialize } from './serialize.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_PATH = path.join(PACKAGE_ROOT, 'weekspan.schema.json')
const GENERATE_SCRIPT = path.join(PACKAGE_ROOT, 'scripts', 'generate-schema.ts')
// Resolved via Node's own module resolution (walks up node_modules from
// package.json, so this works whether tsx lands hoisted at the workspace
// root or local to this package) rather than a hardcoded relative path.
const TSX_CLI = createRequire(path.join(PACKAGE_ROOT, 'package.json')).resolve('tsx/cli')

describe('weekspan.schema.json — generated, not hand-written', () => {
  it('regenerating from types.ts reproduces the committed file exactly', () => {
    const scratchDir = mkdtempSync(path.join(tmpdir(), 'weekspan-schema-drift-'))
    const scratchOut = path.join(scratchDir, 'weekspan.schema.json')
    try {
      execFileSync(process.execPath, [TSX_CLI, GENERATE_SCRIPT, scratchOut], {
        cwd: PACKAGE_ROOT,
        stdio: 'pipe',
      })
      const regenerated = readFileSync(scratchOut, 'utf8')
      const committed = readFileSync(SCHEMA_PATH, 'utf8')
      // Exact byte comparison, not just JSON deep-equal: the point includes
      // catching nondeterminism (unsorted keys, timestamps) in the generator
      // output, which a parsed deep-equal would hide.
      expect(regenerated).toBe(committed)
    } finally {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })
})

describe('weekspan.schema.json — validation (ajv)', () => {
  function compile(): ValidateFunction {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
    const ajv = new Ajv({ strict: true, allErrors: true })
    return ajv.compile(schema)
  }

  function baseWeekspan(): Weekspan {
    return {
      version: SCHEMA_VERSION,
      closedThrough: null,
      vacationDays: [],
      projects: [],
      items: [],
    }
  }

  /** Serialize through the real serializer, then parse back — real on-disk shape. */
  function toJSON(weekspan: Weekspan): unknown {
    return JSON.parse(serialize(weekspan))
  }

  describe('valid weekspans pass', () => {
    it('an empty weekspan', () => {
      const validate = compile()
      expect(validate(toJSON(baseWeekspan()))).toBe(true)
    })

    it('a weekspan with every mark kind, recurrence, links, nesting, and projects', () => {
      const validate = compile()
      const items: Item[] = [
        {
          id: 'parent',
          title: 'Trip planning',
          rank: 'aV',
          marks: {
            '2026-08-17': { kind: 'due' },
            '2026-08-18': { kind: 'done' },
            '2026-08-24': { kind: 'skip', provenance: 'deliberate' },
            '2026-08-31': { kind: 'skip', provenance: 'auto' },
          },
          parentId: null,
          projectId: 'proj-1',
          notes: '- pack early',
          links: [{ url: 'https://example.com', title: 'Example', kind: 'favicon' }],
          recurrence: { freq: 'weekly', weekday: 3, anchor: '2026-08-01', until: '2026-12-31' },
        },
        { id: 'child', title: 'Book flights', rank: 'am', marks: {}, parentId: 'parent' },
      ]
      const weekspan: Weekspan = {
        ...baseWeekspan(),
        closedThrough: '2026-W30',
        vacationDays: ['2026-07-04', '2026-12-25'],
        projects: [{ id: 'proj-1', name: 'Home', colorToken: 'barA' }],
        items,
      }
      const out = toJSON(weekspan)
      expect(validate(out)).toBe(true)
    })

    it('an item whose optional fields are all explicit null (parentId, projectId, recurrence)', () => {
      const validate = compile()
      const weekspan: Weekspan = {
        ...baseWeekspan(),
        items: [
          { id: 'a', title: 'A', rank: 'a', marks: {}, parentId: null, projectId: null, recurrence: null },
        ],
      }
      expect(validate(toJSON(weekspan))).toBe(true)
    })
  })

  describe('invalid data fails', () => {
    // These four are deliberately shaped to violate constraints the TS
    // compiler itself would refuse to construct (an unmarked skip has no
    // `provenance` field to omit; a discriminated union can't hold a `due`
    // with `provenance` at all; `rank` is non-optional on `Item`). That's
    // exactly why they're built as loose object literals rather than typed
    // `Weekspan`/`Item` values run through `serialize()` — the schema has to
    // catch what the type system only catches for callers already using TS.
    // `$schema`/`$agent` are omitted since both are optional in the schema
    // and irrelevant to what each case is testing.
    function invalidWeekspanBase() {
      return { version: SCHEMA_VERSION, closedThrough: null, vacationDays: [], projects: [] }
    }

    it('rejects a skip mark missing provenance', () => {
      const validate = compile()
      const doc = {
        ...invalidWeekspanBase(),
        items: [{ id: 'a', title: 'A', rank: 'a', marks: { '2026-08-20': { kind: 'skip' } } }],
      }
      expect(validate(doc)).toBe(false)
    })

    it('rejects a due mark carrying provenance', () => {
      const validate = compile()
      const doc = {
        ...invalidWeekspanBase(),
        items: [
          {
            id: 'a',
            title: 'A',
            rank: 'a',
            marks: { '2026-08-20': { kind: 'due', provenance: 'deliberate' } },
          },
        ],
      }
      expect(validate(doc)).toBe(false)
    })

    it('rejects an item missing rank', () => {
      const validate = compile()
      const doc = { ...invalidWeekspanBase(), items: [{ id: 'a', title: 'A', marks: {} }] }
      expect(validate(doc)).toBe(false)
    })

    it('rejects a bad date key in marks', () => {
      const validate = compile()
      const doc = {
        ...invalidWeekspanBase(),
        items: [{ id: 'a', title: 'A', rank: 'a', marks: { 'not-a-date': { kind: 'due' } } }],
      }
      expect(validate(doc)).toBe(false)
    })
  })
})
