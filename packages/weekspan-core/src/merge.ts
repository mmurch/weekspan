import type { IsoDate, Item, Weekspan, Link, Mark, Project } from './types.js'

/**
 * Semantic three-way merge.
 *
 * This is what makes a serverless, file-as-truth weekspan survivable. Dropbox, Drive
 * and iCloud resolve a simultaneous write by picking a whole file or dropping a
 * "conflicted copy" beside it. Because we parse the file into a real structure, we
 * can merge at the level of individual items and individual CELLS instead — which
 * for a single user across a laptop and a phone means conflicts essentially always
 * resolve cleanly.
 *
 *   base   — what we last read from disk
 *   ours   — what is in memory now
 *   theirs — what is on disk now (someone else, or another device, wrote it)
 *
 * The client checks `lastModified` before every write; if it moved, it re-reads and
 * merges rather than clobbering.
 *
 * There are no timestamps in the file, so last-writer-wins is not available to us as
 * a tiebreak. Genuine conflicts resolve in favour of `ours` — the state the user is
 * currently looking at — and every one is REPORTED rather than silently applied, so
 * the UI can say what happened instead of quietly losing an edit.
 */

export type ConflictResolution = 'ours' | 'theirs'

export interface MergeConflict {
  itemId: string | null
  /** e.g. `title`, `marks.2026-08-26`, `closedThrough` */
  field: string
  base: unknown
  ours: unknown
  theirs: unknown
  resolution: ConflictResolution
}

export interface MergeStats {
  itemsAdded: number
  itemsRemoved: number
  itemsChanged: number
  marksChanged: number
}

export interface MergeResult {
  merged: Weekspan
  conflicts: MergeConflict[]
  stats: MergeStats
}

/** Structural equality over the JSON-shaped values that appear in a weekspan. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined)
  if (ak.length !== bk.length) return false
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]))
}

interface ThreeWay<T> {
  value: T
  conflict: boolean
}

/**
 * The core rule. If only one side moved, take that side — that is not a conflict,
 * it is just an edit the other side never saw.
 */
function threeWay<T>(base: T, ours: T, theirs: T): ThreeWay<T> {
  if (deepEqual(ours, theirs)) return { value: ours, conflict: false }
  if (deepEqual(ours, base)) return { value: theirs, conflict: false }
  if (deepEqual(theirs, base)) return { value: ours, conflict: false }
  return { value: ours, conflict: true }
}

function byId<T extends { id: string }>(xs: readonly T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]))
}

/** Merge one item's cell map, date by date. This is where most real merges land. */
function mergeMarks(
  itemId: string,
  base: Record<IsoDate, Mark>,
  ours: Record<IsoDate, Mark>,
  theirs: Record<IsoDate, Mark>,
  conflicts: MergeConflict[],
): { marks: Record<IsoDate, Mark>; changed: number } {
  const dates = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
  const marks: Record<IsoDate, Mark> = {}
  let changed = 0

  for (const date of [...dates].sort()) {
    const b = base[date]
    const o = ours[date]
    const t = theirs[date]
    const r = threeWay(b, o, t)
    if (r.conflict) {
      conflicts.push({
        itemId,
        field: `marks.${date}`,
        base: b,
        ours: o,
        theirs: t,
        resolution: 'ours',
      })
    }
    if (r.value !== undefined) marks[date] = r.value
    if (!deepEqual(r.value, b)) changed++
  }

  return { marks, changed }
}

function mergeLinks(base: Link[], ours: Link[], theirs: Link[]): Link[] {
  // Links are a set keyed by url: a link resolved on one device and a different link
  // added on another should both survive rather than one array clobbering the other.
  const baseUrls = new Set(base.map((l) => l.url))
  const out = new Map<string, Link>()

  for (const l of ours) out.set(l.url, l)
  for (const l of theirs) {
    const existing = out.get(l.url)
    if (!existing) {
      // Present in theirs but not ours: keep it unless we deliberately removed it.
      if (!baseUrls.has(l.url)) out.set(l.url, l)
    }
  }
  // Drop anything both sides removed.
  for (const l of base) {
    const inOurs = ours.some((x) => x.url === l.url)
    const inTheirs = theirs.some((x) => x.url === l.url)
    if (!inOurs && !inTheirs) out.delete(l.url)
  }
  return [...out.values()]
}

const SCALAR_FIELDS = [
  'title',
  'notes',
  'parentId',
  'projectId',
  'rank',
  'recurrence',
] as const

function mergeItem(
  base: Item | undefined,
  ours: Item,
  theirs: Item,
  conflicts: MergeConflict[],
): { item: Item; marksChanged: number } {
  const b = base ?? ours
  const merged: Item = { ...ours }

  for (const field of SCALAR_FIELDS) {
    const r = threeWay(b[field], ours[field], theirs[field])
    if (r.conflict) {
      conflicts.push({
        itemId: ours.id,
        field,
        base: b[field],
        ours: ours[field],
        theirs: theirs[field],
        resolution: 'ours',
      })
    }
    if (r.value === undefined) delete merged[field]
    else (merged as unknown as Record<string, unknown>)[field] = r.value
  }

  const marksResult = mergeMarks(ours.id, b.marks ?? {}, ours.marks, theirs.marks, conflicts)
  merged.marks = marksResult.marks

  const links = mergeLinks(b.links ?? [], ours.links ?? [], theirs.links ?? [])
  if (links.length > 0) merged.links = links
  else delete merged.links

  return { item: merged, marksChanged: marksResult.changed }
}

/**
 * Merge a keyed collection under edit-beats-delete.
 *
 * If one side deleted a record and the other edited it, the edit wins and the record
 * survives. Losing work silently is much worse than a stray row the user can delete
 * again deliberately.
 */
function mergeCollection<T extends { id: string }>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  mergeOne: (b: T | undefined, o: T, t: T) => T,
): { items: T[]; added: number; removed: number; changed: number } {
  const bm = byId(base)
  const om = byId(ours)
  const tm = byId(theirs)
  const ids = new Set([...om.keys(), ...tm.keys()])

  const out: T[] = []
  let added = 0
  let removed = 0
  let changed = 0

  for (const id of ids) {
    const b = bm.get(id)
    const o = om.get(id)
    const t = tm.get(id)

    if (o && t) {
      const m = mergeOne(b, o, t)
      out.push(m)
      if (!b) added++
      else if (!deepEqual(m, b)) changed++
      continue
    }

    if (o && !t) {
      // They deleted it. Keep it only if we changed it since base.
      if (!b) {
        out.push(o)
        added++
      } else if (!deepEqual(o, b)) {
        out.push(o)
        changed++
      } else {
        removed++
      }
      continue
    }

    if (t && !o) {
      // We deleted it. Keep it only if they changed it since base.
      if (!b) {
        out.push(t)
        added++
      } else if (!deepEqual(t, b)) {
        out.push(t)
        changed++
      } else {
        removed++
      }
    }
  }

  return { items: out, added, removed, changed }
}

export function merge(base: Weekspan, ours: Weekspan, theirs: Weekspan): MergeResult {
  const conflicts: MergeConflict[] = []
  let marksChanged = 0

  const itemResult = mergeCollection(base.items, ours.items, theirs.items, (b, o, t) => {
    const r = mergeItem(b, o, t, conflicts)
    marksChanged += r.marksChanged
    return r.item
  })

  const projectResult = mergeCollection(base.projects, ours.projects, theirs.projects, (b, o, t) => {
    const merged: Project = { ...o }
    for (const field of ['name', 'colorToken'] as const) {
      const r = threeWay((b ?? o)[field], o[field], t[field])
      if (r.conflict) {
        conflicts.push({
          itemId: null,
          field: `project.${o.id}.${field}`,
          base: (b ?? o)[field],
          ours: o[field],
          theirs: t[field],
          resolution: 'ours',
        })
      }
      merged[field] = r.value
    }
    return merged
  })

  // Close-out is monotonic — a week never re-opens — so the later pointer always wins.
  // This is a real semantic merge rather than a tiebreak, and it means two devices
  // closing weeks independently converge instead of fighting.
  const closedThrough = maxWeek(ours.closedThrough, theirs.closedThrough)

  // Vacation days: apply both sides' additions and both sides' removals.
  const baseVac = new Set(base.vacationDays)
  const oursVac = new Set(ours.vacationDays)
  const theirsVac = new Set(theirs.vacationDays)
  const vacation = new Set<string>()
  for (const d of new Set([...oursVac, ...theirsVac])) {
    const removedByUs = baseVac.has(d) && !oursVac.has(d)
    const removedByThem = baseVac.has(d) && !theirsVac.has(d)
    if (!removedByUs && !removedByThem) vacation.add(d)
  }

  const merged: Weekspan = {
    ...ours,
    version: Math.max(ours.version, theirs.version),
    closedThrough,
    vacationDays: [...vacation].sort(),
    projects: projectResult.items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    items: itemResult.items.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)),
  }

  return {
    merged,
    conflicts,
    stats: {
      itemsAdded: itemResult.added,
      itemsRemoved: itemResult.removed,
      itemsChanged: itemResult.changed,
      marksChanged,
    },
  }
}

function maxWeek(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a >= b ? a : b
}

/** True when `theirs` contains nothing `base` did not — i.e. we can write without merging. */
export function isUnchanged(base: Weekspan, theirs: Weekspan): boolean {
  return deepEqual(base, theirs)
}
