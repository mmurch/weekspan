/**
 * The ledger schema.
 *
 * Key naming is camelCase in BOTH the TypeScript types and the on-disk JSON.
 * The handoff used snake_case (`parent_id`, `done_on`), but a key-mapping layer
 * between file and memory is exactly the kind of thing that breaks byte-stable
 * round-tripping, and byte-stability is load-bearing here: two clients writing
 * identical state must produce identical files or sync churns.
 */

/** Calendar date, `YYYY-MM-DD`. Never a timestamp — the grid has no time-of-day. */
export type IsoDate = string

/** ISO week, `2026-W35`. Weeks start Monday. */
export type IsoWeek = string

/** Current on-disk schema version. Bump on any breaking shape change. */
export const SCHEMA_VERSION = 1

export type MarkKind = 'due' | 'done' | 'skip'

/**
 * How a skip came to exist.
 *
 * `deliberate` — the user chose to skip while present.
 * `auto`       — auto-close resolved an unresolved recurring occurrence during
 *                catch-up, because returning to a neglected ledger must never
 *                cost more than a glance.
 *
 * Skip-streak surfacing must count only `deliberate` skips. Without this split,
 * three months away would write a dozen auto-skips onto a weekly item and drown
 * the very signal skip exists to expose.
 */
export type SkipProvenance = 'deliberate' | 'auto'

/**
 * A cell value. Modelled as a discriminated union so that
 * `{ kind: 'due', provenance: 'deliberate' }` is a COMPILE error rather than a
 * runtime throw, and so `provenance` is REQUIRED on a skip rather than optional.
 *
 * That second property is the important one: a skip that loses its provenance is
 * indistinguishable from one that never had it, which would make three months of
 * absence look identical to three months of avoidance in the skip-streak data.
 */
export type Mark =
  | { kind: 'due' }
  | { kind: 'done' }
  | { kind: 'skip'; provenance: SkipProvenance }

export type RecurrenceFreq = 'weekly' | 'biweekly' | 'monthly'

export interface Recurrence {
  freq: RecurrenceFreq
  /** 1 = Monday .. 7 = Sunday. Required for `weekly` and `biweekly`. */
  weekday?: number
  /** 1..31. Required for `monthly`. Months that are too short are skipped, not clamped. */
  monthday?: number
  /** Series start. Also fixes the phase for `biweekly` (which fortnight is "on"). */
  anchor: IsoDate
  /** Inclusive last date the series can generate, if bounded. */
  until?: IsoDate
}

export interface Link {
  url: string
  /** Resolved once on paste and cached here so chips render offline. */
  title: string
  /** Favicon/kind hint. Icon BYTES live in a per-device cache, never in the file. */
  kind?: string
}

export interface Item {
  id: string
  title: string
  /** Markdown. Bullet lists render under the title. */
  notes?: string
  /** One level of nesting only. */
  parentId?: string | null
  /** Project id, not name — renames must not rewrite every item. */
  projectId?: string | null
  /**
   * Base62 fractional index. The single ordering spine, never displayed.
   * Scoped to siblings: global order = roots by rank, then each root's children by rank.
   */
  rank: string
  /**
   * Sparse cell map, date -> mark. At most one mark per (item, date), matching the
   * mutually-exclusive cell menu. Replaces the handoff's single `due` / `done_on`.
   */
  marks: Record<IsoDate, Mark>
  /** Rule only. Occurrences are generated at read time and never written. */
  recurrence?: Recurrence | null
  links?: Link[]
}

export interface Project {
  id: string
  name: string
  /** Token name from the theme ramp (`barA`, `barB`, ...), not a literal color. */
  colorToken: string
}

/** The working ledger file. */
export interface Ledger {
  /** Advisory pointer for editors/agents. */
  $schema?: string
  /** Loud warning for any agent that meets this file with no folder context. */
  $agent?: string
  version: number
  /**
   * Last week closed out, or null if none ever were. Close-out is strictly
   * sequential, so one pointer replaces a set of closed weeks — and only one
   * week ever shows the close affordance.
   *
   * Also the window's left edge: the grid starts at the oldest unclosed week.
   */
  closedThrough: IsoWeek | null
  /** Days marked vacation. In the file because agents must not schedule into them. */
  vacationDays: IsoDate[]
  projects: Project[]
  items: Item[]
}

/** One archive file per closed-out week: `archive/2026-W35.json`. */
export interface ArchiveFile {
  version: number
  week: IsoWeek
  items: Item[]
}

export const AGENT_WARNING =
  'Do not hand-edit; run `npx ledger --help` or see ./AGENTS.md'
