/**
 * Deterministic, byte-stable serialization of the weekspan schema.
 *
 * "Byte-stable" is load-bearing (see ARCHITECTURE.md "Format"): two clients
 * writing identical logical state must produce identical bytes, or file sync
 * churns on formatting alone. That means:
 *
 *   - fixed key order per type, defined explicitly below (never `Object.keys`
 *     or JS insertion order on the *input* value — we always rebuild plain
 *     objects field-by-field in a chosen order)
 *   - collections sorted by an explicit, locale-independent comparator
 *   - `$schema` / `$agent` are always forced to canonical constants, never
 *     taken from the input, so two weekspans that differ only in those headers
 *     still serialize identically. `version` is the one exception: it
 *     describes the shape of the data in the file (see MIGRATIONS.md) and is
 *     always written verbatim from the input. Only a migration may change
 *     it — `serialize` must never substitute `SCHEMA_VERSION` for it, or a
 *     v1-shaped weekspan could get silently re-labeled as v2 on an unrelated
 *     edit.
 *   - optional fields are omitted from the output when `undefined`; fields
 *     whose type allows `null` (`parentId`, `projectId`, `recurrence`,
 *     `closedThrough`) emit `null` explicitly, since that's a meaningful
 *     state distinct from "field absent"
 */

import type { ArchiveFile, IsoDate, Item, Weekspan, Link, Mark, Project, Recurrence } from './types.js'
import { AGENT_WARNING } from './types.js'

/**
 * Advisory `$schema` pointer written into every weekspan/archive file header.
 * Not defined elsewhere in the codebase; picked here since it's purely
 * advisory (per types.ts) and always forced on write regardless of what an
 * in-memory `Weekspan.$schema` happens to hold.
 *
 * Relative, not a URL: nobody owns a domain to host this at, and a relative
 * path fits the "files in a folder" architecture — editors resolve a
 * relative `$schema` against the file's own location with no hosting or DNS
 * involved. The referenced file, `weekspan.schema.json`, is GENERATED from
 * `types.ts` by `scripts/generate-schema.ts` (`npm run generate:schema`);
 * see that script's header comment and `src/schema.test.ts` for how drift
 * between the two is caught. It describes the current `SCHEMA_VERSION`
 * shape only — see MIGRATIONS.md before this needs a versioned filename.
 */
export const SCHEMA_URI = './weekspan.schema.json'

type Json = Record<string, unknown>

/** Plain code-unit comparison — locale-independent, so sort order can't vary across environments/engines. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Sets `key` on `target` only when `value` isn't `undefined`; `null` is set through. */
function setIfDefined(target: Json, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value
}

function markToJSON(mark: Mark): Json {
  const out: Json = {}
  out.kind = mark.kind
  if (mark.kind === 'skip') out.provenance = mark.provenance
  return out
}

function marksToJSON(marks: Record<IsoDate, Mark>): Json {
  const out: Json = {}
  const entries = Object.entries(marks).sort((a, b) => compareStrings(a[0], b[0]))
  for (const [date, mark] of entries) {
    out[date] = markToJSON(mark)
  }
  return out
}

function recurrenceToJSON(recurrence: Recurrence): Json {
  const out: Json = {}
  out.freq = recurrence.freq
  setIfDefined(out, 'weekday', recurrence.weekday)
  setIfDefined(out, 'monthday', recurrence.monthday)
  out.anchor = recurrence.anchor
  setIfDefined(out, 'until', recurrence.until)
  return out
}

function linkToJSON(link: Link): Json {
  const out: Json = {}
  out.url = link.url
  out.title = link.title
  setIfDefined(out, 'kind', link.kind)
  return out
}

function itemToJSON(item: Item): Json {
  const out: Json = {}
  out.id = item.id
  out.title = item.title
  setIfDefined(out, 'notes', item.notes)
  setIfDefined(out, 'parentId', item.parentId)
  setIfDefined(out, 'projectId', item.projectId)
  out.rank = item.rank
  out.marks = marksToJSON(item.marks)
  if (item.recurrence !== undefined) {
    out.recurrence = item.recurrence === null ? null : recurrenceToJSON(item.recurrence)
  }
  if (item.links !== undefined) {
    out.links = item.links.map(linkToJSON)
  }
  return out
}

/** Items sorted by rank ascending, plain string compare (ranks are base62 fractional index keys). */
function itemsToJSON(items: Item[]): Json[] {
  return [...items].sort((a, b) => compareStrings(a.rank, b.rank)).map(itemToJSON)
}

function projectToJSON(project: Project): Json {
  return { id: project.id, name: project.name, colorToken: project.colorToken }
}

function projectsToJSON(projects: Project[]): Json[] {
  return [...projects].sort((a, b) => compareStrings(a.id, b.id)).map(projectToJSON)
}

/** Serialize the working weekspan file. 2-space indent, trailing newline. */
export function serialize(weekspan: Weekspan): string {
  const out: Json = {}
  out.$schema = SCHEMA_URI
  out.$agent = AGENT_WARNING
  out.version = weekspan.version
  out.closedThrough = weekspan.closedThrough
  out.vacationDays = [...weekspan.vacationDays].sort(compareStrings)
  out.projects = projectsToJSON(weekspan.projects)
  out.items = itemsToJSON(weekspan.items)
  return JSON.stringify(out, null, 2) + '\n'
}

/** Serialize one closed-out week's archive file. Same rules as `serialize`, minus the `$schema`/`$agent` header (not part of `ArchiveFile`). `version` is written verbatim, same as `serialize` — see MIGRATIONS.md. */
export function serializeArchive(archive: ArchiveFile): string {
  const out: Json = {}
  out.version = archive.version
  out.week = archive.week
  out.items = itemsToJSON(archive.items)
  return JSON.stringify(out, null, 2) + '\n'
}
