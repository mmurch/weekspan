/**
 * Construction helpers for brand-new weekspans and archive files.
 *
 * `version` is load-bearing (see MIGRATIONS.md): it describes the shape of
 * the data in the file, not "the newest version this client knows about."
 * `serialize`/`serializeArchive` write it verbatim rather than substituting
 * `SCHEMA_VERSION`, which means nothing else in this package may stamp a
 * version onto existing data. These two factories are the one exception —
 * they exist specifically to give callers ONE obvious correct way to build a
 * genuinely NEW weekspan/archive header, so nobody hand-builds one and has to
 * guess at the right version number.
 */

import type { ArchiveFile, IsoDate, IsoWeek, Item, Weekspan, Project } from './types.js'
import { SCHEMA_VERSION } from './types.js'

/**
 * Build a brand-new, empty-by-default `Weekspan`, stamped with the current
 * `SCHEMA_VERSION`. Use this for genuinely new weekspans only — never to
 * rebuild a weekspan that was parsed from an existing file, since that would
 * discard whatever version the file actually carried.
 */
export function createWeekspan(
  init?: Partial<Pick<Weekspan, 'projects' | 'items' | 'vacationDays' | 'closedThrough'>>,
): Weekspan {
  const projects: Project[] = init?.projects ?? []
  const items: Item[] = init?.items ?? []
  const vacationDays: IsoDate[] = init?.vacationDays ?? []
  const closedThrough: IsoWeek | null = init?.closedThrough ?? null
  return {
    version: SCHEMA_VERSION,
    closedThrough,
    vacationDays,
    projects,
    items,
  }
}

/**
 * Build a brand-new `ArchiveFile` for a just-closed week, stamped with the
 * current `SCHEMA_VERSION`. As with `createWeekspan`, this is for a week being
 * closed out now — an archive read back from disk already carries its own
 * (possibly older) version and must not be rebuilt through this function.
 */
export function createArchive(week: IsoWeek, items: Item[]): ArchiveFile {
  return {
    version: SCHEMA_VERSION,
    week,
    items,
  }
}
