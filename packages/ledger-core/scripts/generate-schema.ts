/**
 * Generates `ledger.schema.json` from the `Ledger` type in `src/types.ts`.
 *
 * This is GENERATED, not hand-written, on purpose: a hand-maintained parallel
 * schema silently drifts from the types it's supposed to describe, which is
 * exactly the failure mode this file exists to avoid. `src/schema.test.ts`
 * shells out to this same script and asserts its output deep-equals the
 * committed `ledger.schema.json`, so editing `types.ts` without re-running
 * `npm run generate:schema` fails the test suite.
 *
 * This schema describes the CURRENT `SCHEMA_VERSION` shape only (see
 * types.ts). There is no versioned-filename machinery here — when a v2
 * lands, see MIGRATIONS.md for the version contract this will need to
 * respect (the file's `version` field is data, never rewritten by tooling
 * that isn't a migration).
 *
 * Usage:
 *   tsx scripts/generate-schema.ts             # writes ./ledger.schema.json
 *   tsx scripts/generate-schema.ts <out-path>   # writes to <out-path> instead
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { createGenerator, type Config, type Schema } from 'ts-json-schema-generator'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const TYPES_PATH = path.join(PACKAGE_ROOT, 'src', 'types.ts')
const TSCONFIG_PATH = path.join(PACKAGE_ROOT, 'tsconfig.json')
const DEFAULT_OUTPUT_PATH = path.join(PACKAGE_ROOT, 'ledger.schema.json')

/** `types.ts`: `IsoDate` is `YYYY-MM-DD`, never a timestamp. */
const ISO_DATE_KEY_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'

type JsonRecord = Record<string, unknown>

/** Generate the schema and return it as a plain object (pre-serialization). */
export function generateSchema(): Schema {
  const config: Config = {
    path: TYPES_PATH,
    tsconfig: TSCONFIG_PATH,
    type: 'Ledger',
    expose: 'export',
    topRef: true,
    jsDoc: 'extended',
    additionalProperties: false,
    sortProps: true,
    // The package tsconfig pulls in `types: ["vitest/globals"]` for test
    // files, which has nothing to do with (and isn't resolvable purely from)
    // types.ts. types.ts is already type-checked by the package's own
    // `tsc --noEmit`; skip re-checking it inside the generator's own program.
    skipTypeCheck: true,
  }
  const schema = createGenerator(config).createSchema(config.type)
  postProcess(schema)
  return schema
}

/**
 * Fix two things by hand that the generator gets wrong or leaves undone for
 * this schema, checked by eye against `src/types.ts`:
 *
 * 1. `Mark` is a discriminated union (`{kind:'due'}`, `{kind:'done'}`,
 *    `{kind:'skip', provenance}`), mutually exclusive on `kind`, with
 *    `provenance` required on `skip` and absent (`additionalProperties:
 *    false`) from the other branches. The generator already gets the hard
 *    part right unassisted — it emits three branches, each with a `const`
 *    `kind` and `additionalProperties: false`, and only the `skip` branch
 *    requires `provenance` — but it joins them with `anyOf`. Since the
 *    branches are already provably mutually exclusive (distinct `kind`
 *    const, no additional properties), we upgrade `anyOf` to `oneOf` here:
 *    `oneOf` is the correct JSON Schema keyword for "exactly one of these
 *    shapes", which is what a discriminated union means.
 *
 * 2. `Item.marks` is `Record<IsoDate, Mark>`. The generator emits this as a
 *    bare `additionalProperties: {$ref: Mark}` with no constraint on the key
 *    shape, so any string key (including a garbage one) validates. We
 *    replace that with `patternProperties` keyed on the `IsoDate` format
 *    (`YYYY-MM-DD`) plus `additionalProperties: false`, so a malformed date
 *    key is actually rejected instead of silently accepted.
 */
function postProcess(schema: Schema): void {
  const definitions = (schema as { definitions?: Record<string, JsonRecord> }).definitions
  if (!definitions) {
    throw new Error('generate-schema: expected top-level "definitions" — generator output shape changed')
  }

  const mark = definitions.Mark
  if (!mark || !Array.isArray(mark.anyOf)) {
    throw new Error(
      'generate-schema: expected definitions.Mark to be an anyOf union — generator output shape changed, update postProcess()',
    )
  }
  mark.oneOf = mark.anyOf
  delete mark.anyOf

  const item = definitions.Item as { properties?: Record<string, JsonRecord> } | undefined
  const marksProp = item?.properties?.marks
  const markRef = marksProp?.additionalProperties as JsonRecord | undefined
  if (!marksProp || !markRef || typeof markRef.$ref !== 'string') {
    throw new Error(
      'generate-schema: expected Item.properties.marks.additionalProperties to be a $ref — generator output shape changed, update postProcess()',
    )
  }
  delete marksProp.additionalProperties
  delete marksProp.propertyNames
  marksProp.patternProperties = { [ISO_DATE_KEY_PATTERN]: markRef }
  marksProp.additionalProperties = false
}

/** Deterministic serialization: fixed indent, trailing newline, no timestamps. */
export function serializeSchema(schema: Schema): string {
  return JSON.stringify(schema, null, 2) + '\n'
}

function main(): void {
  const outPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT_PATH
  const text = serializeSchema(generateSchema())
  fs.writeFileSync(outPath, text)
  process.stdout.write(`Wrote ${outPath}\n`)
}

// Only run when invoked directly (`tsx scripts/generate-schema.ts`), not when imported.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
