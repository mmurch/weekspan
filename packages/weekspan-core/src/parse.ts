/**
 * Strict parsing of the weekspan schema.
 *
 * v1 is strict by design (see ARCHITECTURE.md "Format" / "Deferred" —
 * a tolerant, repairing reader is explicitly deferred to a later version).
 * That means:
 *
 *   - no repair, no coercion, no silently-defaulted required fields
 *   - unknown/extra keys are rejected at every object level, so a typo fails
 *     loudly instead of being silently dropped on the next write
 *   - every error names the offending path, e.g. `items[3].rank: expected
 *     string, got number`
 *   - a `version` greater than `SCHEMA_VERSION` throws the distinct
 *     `FutureVersionError`, so an old tab refuses a file written by a newer
 *     client instead of silently dropping fields it doesn't understand
 */

import type {
  ArchiveFile,
  IsoDate,
  IsoWeek,
  Item,
  Weekspan,
  Link,
  Mark,
  MarkKind,
  Project,
  Recurrence,
  RecurrenceFreq,
  SkipProvenance,
} from './types.js'
import { SCHEMA_VERSION } from './types.js'
import { isValidIsoDate, isValidIsoWeek } from './dates.js'
import { isValidRank } from './rank.js'

/** Any shape/type/reference violation. `path` names the offending location, e.g. `items[3].rank`. */
export class ParseError extends Error {
  constructor(
    public readonly path: string,
    detail: string,
  ) {
    super(path ? `${path}: ${detail}` : detail)
    this.name = 'ParseError'
  }
}

/**
 * The file's `version` is greater than this build's `SCHEMA_VERSION`.
 *
 * Distinct from `ParseError` on purpose: callers (e.g. the browser app) need
 * to tell "this file is malformed" apart from "this file is fine, you're
 * just running an old client" and show a different message for each.
 */
export class FutureVersionError extends Error {
  constructor(
    public readonly fileVersion: number,
    public readonly supportedVersion: number = SCHEMA_VERSION,
  ) {
    super(
      `Weekspan file version ${fileVersion} is newer than supported version ${supportedVersion}. Refusing to parse — upgrade the client.`,
    )
    this.name = 'FutureVersionError'
  }
}

// ---------------------------------------------------------------------------
// Generic validation toolkit
// ---------------------------------------------------------------------------

function fail(path: string, detail: string): never {
  throw new ParseError(path, detail)
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function indexPath(path: string, i: number): string {
  return `${path}[${i}]`
}

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function expectString(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, `expected string, got ${typeName(v)}`)
  return v
}

function expectInteger(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, `expected integer, got ${typeName(v)}`)
  return v
}

function expectObject(v: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail(path, `expected object, got ${typeName(v)}`)
  return v
}

function expectArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, `expected array, got ${typeName(v)}`)
  return v
}

function expectIsoDate(v: unknown, path: string): IsoDate {
  const s = expectString(v, path)
  if (!isValidIsoDate(s)) fail(path, `invalid IsoDate ${JSON.stringify(s)}`)
  return s
}

function expectIsoWeek(v: unknown, path: string): IsoWeek {
  const s = expectString(v, path)
  if (!isValidIsoWeek(s)) fail(path, `invalid IsoWeek ${JSON.stringify(s)}`)
  return s
}

function expectVersion(v: unknown, path: string): number {
  const n = expectInteger(v, path)
  if (n > SCHEMA_VERSION) throw new FutureVersionError(n)
  if (n < 1) fail(path, `expected a positive integer, got ${n}`)
  return n
}

function expectEnum<T extends string>(allowed: readonly T[]) {
  return (v: unknown, path: string): T => {
    const s = expectString(v, path)
    if (!(allowed as readonly string[]).includes(s)) {
      fail(path, `expected one of ${allowed.map((a) => JSON.stringify(a)).join(' | ')}, got ${JSON.stringify(s)}`)
    }
    return s as T
  }
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(path, `unknown key ${JSON.stringify(key)}`)
  }
}

type Validator<T> = (v: unknown, path: string) => T

function requireField<T>(obj: Record<string, unknown>, key: string, path: string, validate: Validator<T>): T {
  const p = joinPath(path, key)
  if (!(key in obj)) fail(p, 'required field missing')
  return validate(obj[key], p)
}

function optionalField<T>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  validate: Validator<T>,
): T | undefined {
  if (!(key in obj)) return undefined
  return validate(obj[key], joinPath(path, key))
}

/** Field is `T | null`, required to be present (but may be `null`). */
function requireNullableField<T>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  validate: Validator<T>,
): T | null {
  const p = joinPath(path, key)
  if (!(key in obj)) fail(p, 'required field missing')
  const v = obj[key]
  return v === null ? null : validate(v, p)
}

/** Field is `T | null`, may be absent entirely. */
function optionalNullableField<T>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  validate: Validator<T>,
): T | null | undefined {
  if (!(key in obj)) return undefined
  const p = joinPath(path, key)
  const v = obj[key]
  return v === null ? null : validate(v, p)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new ParseError('', `invalid JSON: ${(err as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// Enum tables
// ---------------------------------------------------------------------------

const MARK_KINDS: readonly MarkKind[] = ['due', 'done', 'skip']
const SKIP_PROVENANCES: readonly SkipProvenance[] = ['deliberate', 'auto']
const RECURRENCE_FREQS: readonly RecurrenceFreq[] = ['weekly', 'biweekly', 'monthly']

const expectMarkKind = expectEnum(MARK_KINDS)
const expectSkipProvenance = expectEnum(SKIP_PROVENANCES)
const expectRecurrenceFreq = expectEnum(RECURRENCE_FREQS)

// ---------------------------------------------------------------------------
// Per-type parsers
// ---------------------------------------------------------------------------

const MARK_KEYS = ['kind', 'provenance'] as const

function parseMark(raw: unknown, path: string): Mark {
  const obj = expectObject(raw, path)
  rejectUnknownKeys(obj, MARK_KEYS, path)
  const kind = requireField(obj, 'kind', path, expectMarkKind)
  const provenance = optionalField(obj, 'provenance', path, expectSkipProvenance)

  if (kind !== 'skip') {
    if (provenance !== undefined) {
      fail(
        joinPath(path, 'provenance'),
        `must not be present unless kind is "skip" (kind is ${JSON.stringify(kind)})`,
      )
    }
    return { kind }
  }

  // Provenance is REQUIRED on a skip. Defaulting it would be worse than rejecting:
  // a skip silently defaulted to "deliberate" makes an absence look like avoidance,
  // and the skip-streak feature this field exists for would report it as such.
  if (provenance === undefined) {
    fail(
      joinPath(path, 'provenance'),
      'is required when kind is "skip" (expected "deliberate" or "auto")',
    )
  }
  return { kind: 'skip', provenance }
}

function parseMarks(raw: unknown, path: string): Record<IsoDate, Mark> {
  const obj = expectObject(raw, path)
  const marks: Record<IsoDate, Mark> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!isValidIsoDate(key)) fail(path, `invalid IsoDate key ${JSON.stringify(key)}`)
    marks[key] = parseMark(value, `${path}[${JSON.stringify(key)}]`)
  }
  return marks
}

const RECURRENCE_KEYS = ['freq', 'weekday', 'monthday', 'anchor', 'until'] as const

function parseRecurrence(raw: unknown, path: string): Recurrence {
  const obj = expectObject(raw, path)
  rejectUnknownKeys(obj, RECURRENCE_KEYS, path)

  const freq = requireField(obj, 'freq', path, expectRecurrenceFreq)
  const weekday = optionalField(obj, 'weekday', path, expectInteger)
  const monthday = optionalField(obj, 'monthday', path, expectInteger)
  const anchor = requireField(obj, 'anchor', path, expectIsoDate)
  const until = optionalField(obj, 'until', path, expectIsoDate)

  if (freq === 'monthly') {
    if (monthday === undefined) fail(joinPath(path, 'monthday'), 'required when freq is "monthly"')
    if (monthday < 1 || monthday > 31) fail(joinPath(path, 'monthday'), `expected 1..31, got ${monthday}`)
    if (weekday !== undefined) fail(joinPath(path, 'weekday'), 'must not be present when freq is "monthly"')
  } else {
    if (weekday === undefined) fail(joinPath(path, 'weekday'), `required when freq is ${JSON.stringify(freq)}`)
    if (weekday < 1 || weekday > 7) fail(joinPath(path, 'weekday'), `expected 1..7, got ${weekday}`)
    if (monthday !== undefined) fail(joinPath(path, 'monthday'), `must not be present when freq is ${JSON.stringify(freq)}`)
  }

  return {
    freq,
    anchor,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(monthday !== undefined ? { monthday } : {}),
    ...(until !== undefined ? { until } : {}),
  } as Recurrence
}

const LINK_KEYS = ['url', 'title', 'kind'] as const

function parseLink(raw: unknown, path: string): Link {
  const obj = expectObject(raw, path)
  rejectUnknownKeys(obj, LINK_KEYS, path)
  const url = requireField(obj, 'url', path, expectString)
  const title = requireField(obj, 'title', path, expectString)
  const kind = optionalField(obj, 'kind', path, expectString)
  return {
    url,
    title,
    ...(kind !== undefined ? { kind } : {}),
  } as Link
}

const ITEM_KEYS = ['id', 'title', 'notes', 'parentId', 'projectId', 'rank', 'marks', 'recurrence', 'links'] as const

function parseItem(raw: unknown, path: string): Item {
  const obj = expectObject(raw, path)
  rejectUnknownKeys(obj, ITEM_KEYS, path)

  const id = requireField(obj, 'id', path, expectString)
  const title = requireField(obj, 'title', path, expectString)
  const notes = optionalField(obj, 'notes', path, expectString)
  const parentId = optionalNullableField(obj, 'parentId', path, expectString)
  const projectId = optionalNullableField(obj, 'projectId', path, expectString)
  const rank = requireField(obj, 'rank', path, expectString)
  // Rank is the ordering spine, and `rankBetween` throws on a malformed key. Catching
  // it here means a hand-edited or agent-written file fails loudly at load rather than
  // at the first drag, long after the bad write.
  if (!isValidRank(rank)) {
    fail(
      joinPath(path, 'rank'),
      `${JSON.stringify(rank)} is not a valid rank key (must be non-empty, use only 0-9A-Za-z, and never end in '0')`,
    )
  }
  const marks = requireField(obj, 'marks', path, parseMarks)
  const recurrence = optionalNullableField(obj, 'recurrence', path, parseRecurrence)
  const linksRaw = optionalField(obj, 'links', path, expectArray)
  const links = linksRaw?.map((r, i) => parseLink(r, indexPath(joinPath(path, 'links'), i)))

  return {
    id,
    title,
    rank,
    marks,
    ...(notes !== undefined ? { notes } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(recurrence !== undefined ? { recurrence } : {}),
    ...(links !== undefined ? { links } : {}),
  } as Item
}

/**
 * Parses an item array and enforces the cross-item invariants: no duplicate
 * ids, every `parentId` resolves to an item in the same array, and nesting
 * is exactly one level deep (a parent may not itself have a parent).
 */
function parseItemsArray(raw: unknown, basePath: string): Item[] {
  const arr = expectArray(raw, basePath)
  const items = arr.map((r, i) => parseItem(r, indexPath(basePath, i)))

  const seenIds = new Set<string>()
  items.forEach((item, i) => {
    if (seenIds.has(item.id)) {
      fail(joinPath(indexPath(basePath, i), 'id'), `duplicate item id ${JSON.stringify(item.id)}`)
    }
    seenIds.add(item.id)
  })

  const byId = new Map(items.map((item) => [item.id, item] as const))
  items.forEach((item, i) => {
    if (item.parentId === undefined || item.parentId === null) return
    const path = joinPath(indexPath(basePath, i), 'parentId')
    const parent = byId.get(item.parentId)
    if (!parent) fail(path, `no item with id ${JSON.stringify(item.parentId)}`)
    if (parent.parentId !== undefined && parent.parentId !== null) {
      fail(
        path,
        `parent ${JSON.stringify(item.parentId)} is itself nested (parentId ${JSON.stringify(parent.parentId)}); only one level of nesting is allowed`,
      )
    }
  })

  return items
}

const PROJECT_KEYS = ['id', 'name', 'colorToken'] as const

function parseProject(raw: unknown, path: string): Project {
  const obj = expectObject(raw, path)
  rejectUnknownKeys(obj, PROJECT_KEYS, path)
  const id = requireField(obj, 'id', path, expectString)
  const name = requireField(obj, 'name', path, expectString)
  const colorToken = requireField(obj, 'colorToken', path, expectString)
  return { id, name, colorToken }
}

// ---------------------------------------------------------------------------
// Top-level entry points
// ---------------------------------------------------------------------------

const WEEKSPAN_KEYS = ['$schema', '$agent', 'version', 'closedThrough', 'vacationDays', 'projects', 'items'] as const

/** Parse the working weekspan file. Strict — see module doc. */
export function parse(text: string): Weekspan {
  const raw = parseJson(text)
  const obj = expectObject(raw, '')
  rejectUnknownKeys(obj, WEEKSPAN_KEYS, '')

  const $schema = optionalField(obj, '$schema', '', expectString)
  const $agent = optionalField(obj, '$agent', '', expectString)
  const version = requireField(obj, 'version', '', expectVersion)
  const closedThrough = requireNullableField(obj, 'closedThrough', '', expectIsoWeek)
  const vacationDaysRaw = requireField(obj, 'vacationDays', '', expectArray)
  const vacationDays = vacationDaysRaw.map((v, i) => expectIsoDate(v, indexPath('vacationDays', i)))
  const projectsRaw = requireField(obj, 'projects', '', expectArray)
  const projects = projectsRaw.map((v, i) => parseProject(v, indexPath('projects', i)))
  const items = requireField(obj, 'items', '', parseItemsArray)

  // Symmetric with the parentId check in parseItemsArray. A dangling projectId renders
  // an item with no colour bar and no grouping, which reads as a UI bug rather than the
  // data error it actually is.
  const projectIds = new Set(projects.map((p) => p.id))
  items.forEach((item, i) => {
    if (item.projectId === undefined || item.projectId === null) return
    if (!projectIds.has(item.projectId)) {
      fail(
        joinPath(indexPath('items', i), 'projectId'),
        `no project with id ${JSON.stringify(item.projectId)}`,
      )
    }
  })

  return {
    ...($schema !== undefined ? { $schema } : {}),
    ...($agent !== undefined ? { $agent } : {}),
    version,
    closedThrough,
    vacationDays,
    projects,
    items,
  } as Weekspan
}

const ARCHIVE_KEYS = ['version', 'week', 'items'] as const

/** Parse one closed-out week's archive file. Same rules as `parse`. */
export function parseArchive(text: string): ArchiveFile {
  const raw = parseJson(text)
  const obj = expectObject(raw, '')
  rejectUnknownKeys(obj, ARCHIVE_KEYS, '')

  const version = requireField(obj, 'version', '', expectVersion)
  const week = requireField(obj, 'week', '', expectIsoWeek)
  const items = requireField(obj, 'items', '', parseItemsArray)

  return { version, week, items }
}
