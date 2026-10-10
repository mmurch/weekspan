/**
 * Project-view row list for the Weekspan grid.
 *
 * `buildProjectView` is a LENS on `buildGrid`, not a second view model: weeks,
 * dates, and every per-item `RowVM` (cells, marks, window logic) come straight
 * from `buildGrid` and are reused unchanged. The only new work here is
 * partitioning that same ordered row list into project groups and choosing an
 * order for the groups. See the handoff, "2. Project view (`#3b`)".
 *
 * Rank stays a single spine. `buildGrid`'s rows are already in global
 * `orderItems` order (roots by rank, each root's children immediately after,
 * also by rank) — grouping only partitions that list into buckets; it never
 * re-sorts within a bucket. That's what makes a drag inside a project write
 * the same global `rank` the handoff calls for: Project view never invents
 * a second ordering to keep in sync.
 */

import type { IsoDate, IsoWeek, Item, Weekspan } from '@weekspan/weekspan-core'
import { addWeeks, displayState, latestMarkDate, weekEnd, weekOf, weekStart } from '@weekspan/weekspan-core'
import type { RowVM, WeekBlock } from './viewModel.js'
import { buildGrid } from './viewModel.js'

export type ProjectRow =
  | {
      kind: 'divider'
      projectId: string | null
      name: string
      colorToken: string | null
      meta: string
      collapsed: boolean
    }
  | { kind: 'item'; row: RowVM }

export interface ProjectVM {
  rows: ProjectRow[]
  weeks: WeekBlock[]
  dates: IsoDate[]
  today: IsoDate
  currentWeek: IsoWeek
}

/** Group key: a real project's id, or `null` for the "no project" bucket. */
type GroupKey = string | null

/**
 * "N done last week · M open", computed from real data.
 *
 * `open` is `displayState === 'open'` — not "not finished", so a skipped item
 * doesn't inflate the count. `doneLastWeek` is `displayState === 'finished'`
 * whose `latestMarkDate` falls inside the previous ISO week. Both facts come
 * from weekspan-core's own helpers (`displayState`, `latestMarkDate`) rather
 * than a hand-rolled walk of `item.marks` — the state classification (what
 * counts as "finished") stays owned by the one place that already knows the
 * recurring-item rules.
 */
function computeMeta(items: readonly Item[], today: IsoDate): string {
  const lastWeek = addWeeks(weekOf(today), -1)
  const lastWeekStart = weekStart(lastWeek)
  const lastWeekEnd = weekEnd(lastWeek)

  let doneLastWeek = 0
  let open = 0
  for (const item of items) {
    const state = displayState(item, today)
    if (state === 'open') open++
    if (state === 'finished') {
      const latest = latestMarkDate(item)
      if (latest !== undefined && latest >= lastWeekStart && latest <= lastWeekEnd) {
        doneLastWeek++
      }
    }
  }
  return `${doneLastWeek} done last week · ${open} open`
}

/**
 * Partition `buildGrid`'s row list into project groups and order both the
 * groups and the divider rows around them. Weeks/dates/window logic are
 * untouched — this only reshapes `GridVM.rows` into `ProjectVM.rows`.
 */
export function buildProjectView(
  weekspan: Weekspan,
  today: IsoDate,
  opts?: {
    minWeeks?: number
    collapsed?: ReadonlySet<string | null>
    /** Colour for the unassigned bucket. Per-device; see `projects/noProjectColor.ts`. */
    noProjectColorToken?: string | null
  },
): ProjectVM {
  const grid = buildGrid(weekspan, today, opts?.minWeeks ?? 0, opts?.noProjectColorToken ?? null)
  const collapsed = opts?.collapsed ?? new Set<string | null>()

  const itemsById = new Map<string, Item>(weekspan.items.map((i) => [i.id, i]))

  // Buckets, in first-seen order. Every declared project gets a bucket up
  // front — including ones with zero items — so a project you just created
  // still gets a divider (handoff: an empty project must not be invisible).
  // The `null` bucket (no project) is seeded too, for the same reason: the
  // user asked that everything be reachable in this view even when nothing
  // is unassigned yet.
  const groupRows = new Map<GroupKey, RowVM[]>()
  const groupItems = new Map<GroupKey, Item[]>()
  const keyOrder: GroupKey[] = []
  function ensureGroup(key: GroupKey): void {
    if (groupRows.has(key)) return
    groupRows.set(key, [])
    groupItems.set(key, [])
    keyOrder.push(key)
  }
  for (const p of weekspan.projects) ensureGroup(p.id)
  ensureGroup(null)

  // Scan the grid's already rank-ordered rows exactly once. A row's project
  // membership is looked up from ITS OWN item, never inherited from a parent
  // — nesting (parentId) and grouping (projectId) are independent axes. A
  // child whose project differs from its parent's simply lands in a
  // different bucket; nothing here special-cases that, it falls out of doing
  // the lookup per-row instead of per-parent.
  //
  // Because grid.rows is already parent-then-child, rank-ordered, a stable
  // partition of it preserves both invariants for free: within a bucket,
  // items keep their `orderItems` relative order, and a child that shares
  // its parent's project still appears immediately after that parent.
  for (const row of grid.rows) {
    const item = itemsById.get(row.id)
    const key: GroupKey = item?.projectId ?? null
    ensureGroup(key)
    groupRows.get(key)!.push(row)
    if (item) groupItems.get(key)!.push(item)
  }

  // Group order: by the rank of each group's first item, so the project
  // holding your single top-priority item leads the view — a "where's my
  // most important thing" reading, not an alphabetical directory. Since
  // `grid.rows` is already in that rank order, "first item's rank" reduces to
  // "first occurrence in the scan," recorded as an index below.
  //
  // This is a choice, not the only defensible one: alphabetical-by-name would
  // be more predictable/stable as items complete and priorities shift, at the
  // cost of burying the project you most need to look at. Rank-order was
  // picked to match Priority view's own "most important first" framing.
  //
  // A project with zero items has no rank to sort by; such projects sort
  // after every non-empty one, in the order they're declared in
  // `weekspan.projects` (Array#sort is stable, so this falls out of the
  // input order rather than needing an explicit tiebreaker).
  const firstIndex = new Map<GroupKey, number>()
  grid.rows.forEach((row, i) => {
    const item = itemsById.get(row.id)
    const key: GroupKey = item?.projectId ?? null
    if (!firstIndex.has(key)) firstIndex.set(key, i)
  })

  const projectKeys = keyOrder.filter((k) => k !== null)
  projectKeys.sort((a, b) => {
    const fa = firstIndex.get(a) ?? Number.POSITIVE_INFINITY
    const fb = firstIndex.get(b) ?? Number.POSITIVE_INFINITY
    return fa - fb
  })

  const projectsById = new Map(weekspan.projects.map((p) => [p.id, p]))

  const rows: ProjectRow[] = []
  function emitGroup(key: GroupKey, name: string, colorToken: string | null): void {
    const rowsForGroup = groupRows.get(key) ?? []
    const itemsForGroup = groupItems.get(key) ?? []
    const isCollapsed = collapsed.has(key)
    rows.push({
      kind: 'divider',
      projectId: key,
      name,
      colorToken,
      meta: computeMeta(itemsForGroup, today),
      collapsed: isCollapsed,
    })
    if (!isCollapsed) {
      for (const row of rowsForGroup) rows.push({ kind: 'item', row })
    }
  }

  for (const key of projectKeys) {
    const project = projectsById.get(key)
    // `project` should always be found (every key here came from
    // `weekspan.projects` or was seeded from one), but an item can carry a
    // stale/orphaned `projectId` that no longer names a real project. Rather
    // than drop those items, give the group a visible fallback name instead
    // of silently merging them into "No project" (which would misreport the
    // unassigned count).
    emitGroup(key, project?.name ?? `Unknown project (${key})`, project?.colorToken ?? null)
  }

  // "No project" always last, regardless of rank — the handoff's rank-order
  // rule governs project groups; this bucket is explicitly the exception the
  // user asked for so unassigned work stays reachable without competing with
  // real projects for top position.
  // The unassigned bucket can carry a colour too. It is per-device rather than
  // a field in the file — see `projects/noProjectColor.ts` for why the ledger
  // deliberately does not hold it.
  emitGroup(null, 'No project', opts?.noProjectColorToken ?? null)

  return {
    rows,
    weeks: grid.weeks,
    dates: grid.dates,
    today: grid.today,
    currentWeek: grid.currentWeek,
  }
}
