import type { IsoDate, Item, Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan, rankSequence, setDone } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import type { ProjectRow, ProjectVM } from './projectView.js'
import { buildProjectView } from './projectView.js'
import { buildGrid } from './viewModel.js'
import { demoWeekspan, emptyWeekspan, stressWeekspan } from './fixtures.js'

const today: IsoDate = '2026-08-26' // Wednesday, 2026-W35 (matches viewModel.test.ts)

interface ItemInit {
  id: string
  title?: string
  projectId?: string | null
  parentId?: string | null
  rank: string
}

function mkItem(init: ItemInit): Item {
  const item: Item = {
    id: init.id,
    title: init.title ?? init.id,
    rank: init.rank,
    marks: {},
  }
  if (init.projectId !== undefined) item.projectId = init.projectId
  if (init.parentId !== undefined) item.parentId = init.parentId
  return item
}

/** Reconstruct (divider, member item ids) pairs from a flat `ProjectVM.rows` list. */
function groupsOf(view: ProjectVM): Array<{ divider: Extract<ProjectRow, { kind: 'divider' }>; itemIds: string[] }> {
  const out: Array<{ divider: Extract<ProjectRow, { kind: 'divider' }>; itemIds: string[] }> = []
  let current: (typeof out)[number] | null = null
  for (const row of view.rows) {
    if (row.kind === 'divider') {
      current = { divider: row, itemIds: [] }
      out.push(current)
    } else {
      current!.itemIds.push(row.row.id)
    }
  }
  return out
}

function totalItemCount(weekspan: Weekspan): number {
  return weekspan.items.length
}

describe('buildProjectView — completeness', () => {
  const fixtures: Array<[string, Weekspan]> = [
    ['demo', demoWeekspan(today)],
    ['stress', stressWeekspan(today)],
    ['empty', emptyWeekspan(today)],
  ]

  for (const [name, weekspan] of fixtures) {
    it(`every item appears exactly once across all groups, for ${name}`, () => {
      const view = buildProjectView(weekspan, today)
      const itemRows = view.rows.filter((r): r is Extract<ProjectRow, { kind: 'item' }> => r.kind === 'item')
      expect(itemRows).toHaveLength(totalItemCount(weekspan))

      const ids = itemRows.map((r) => r.row.id)
      expect(new Set(ids).size).toBe(ids.length) // no duplicates
      expect(new Set(ids)).toEqual(new Set(weekspan.items.map((i) => i.id)))
    })
  }
})

describe('buildProjectView — unassigned bucket', () => {
  it('groups items with no project under the null key, and it comes last', () => {
    const view = buildProjectView(demoWeekspan(today), today)
    const groups = groupsOf(view)

    const nullGroup = groups[groups.length - 1]!
    expect(nullGroup.divider.projectId).toBeNull()
    expect(nullGroup.divider.name).toBe('No project')
    // demoWeekspan's only project-less item is the recurring water-plants item.
    expect(nullGroup.itemIds).toEqual(['item-water-plants'])

    // No other group is the null group.
    for (const g of groups.slice(0, -1)) {
      expect(g.divider.projectId).not.toBeNull()
    }
  })

  it('is still present, last, and empty when every item has a project', () => {
    const ranks = rankSequence(2)
    const weekspan = createWeekspan({
      projects: [{ id: 'p1', name: 'Only project', colorToken: 'barA' }],
      items: [
        mkItem({ id: 'a', projectId: 'p1', rank: ranks[0]! }),
        mkItem({ id: 'b', projectId: 'p1', rank: ranks[1]! }),
      ],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)
    const nullGroup = groups[groups.length - 1]!
    expect(nullGroup.divider.projectId).toBeNull()
    expect(nullGroup.itemIds).toEqual([])
  })
})

describe('buildProjectView — group ordering', () => {
  it('orders groups by the rank of their first item (demoWeekspan)', () => {
    const view = buildProjectView(demoWeekspan(today), today)
    const groups = groupsOf(view)
    // item-tiles (proj-kitchen) has the lowest rank of anything in the fixture,
    // so proj-kitchen leads; proj-work and proj-admin follow in the order their
    // own first items appear; "No project" is always last regardless of rank.
    expect(groups.map((g) => g.divider.projectId)).toEqual([
      'proj-kitchen',
      'proj-work',
      'proj-admin',
      null,
    ])
  })

  it('orders groups by first-item rank on a hand-built weekspan, independent of declaration order', () => {
    const ranks = rankSequence(3)
    // Projects declared B, A — but A's item has the lower rank, so A must lead.
    const weekspan = createWeekspan({
      projects: [
        { id: 'proj-b', name: 'B', colorToken: 'barB' },
        { id: 'proj-a', name: 'A', colorToken: 'barA' },
      ],
      items: [
        mkItem({ id: 'item-a', projectId: 'proj-a', rank: ranks[0]! }),
        mkItem({ id: 'item-b', projectId: 'proj-b', rank: ranks[1]! }),
      ],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)
    expect(groups.map((g) => g.divider.projectId)).toEqual(['proj-a', 'proj-b', null])
  })

  it('places an empty project after every group that has an item, in declared order', () => {
    const ranks = rankSequence(1)
    const weekspan = createWeekspan({
      projects: [
        { id: 'proj-empty', name: 'Empty', colorToken: 'barA' },
        { id: 'proj-full', name: 'Full', colorToken: 'barB' },
      ],
      items: [mkItem({ id: 'only', projectId: 'proj-full', rank: ranks[0]! })],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)
    expect(groups.map((g) => g.divider.projectId)).toEqual(['proj-full', 'proj-empty', null])
  })
})

describe('buildProjectView — within-group order and nesting', () => {
  it('keeps orderItems relative order within a group', () => {
    const grid = buildGrid(demoWeekspan(today), today)
    const view = buildProjectView(demoWeekspan(today), today)
    const groups = groupsOf(view)

    for (const g of groups) {
      if (g.divider.projectId === null) continue
      const expected = grid.rows
        .filter((r) => g.itemIds.includes(r.id))
        .map((r) => r.id)
      expect(g.itemIds).toEqual(expected)
    }
  })

  it('a child follows its parent within the same group', () => {
    const view = buildProjectView(demoWeekspan(today), today)
    const groups = groupsOf(view)
    const kitchen = groups.find((g) => g.divider.projectId === 'proj-kitchen')!
    const parentIdx = kitchen.itemIds.indexOf('item-dishwasher')
    const childIdx = kitchen.itemIds.indexOf('item-order-dishwasher')
    expect(parentIdx).toBeGreaterThanOrEqual(0)
    expect(childIdx).toBe(parentIdx + 1)
  })

  it('a parent and child in DIFFERENT projects each get their own group, and neither is lost', () => {
    const ranks = rankSequence(2)
    const weekspan = createWeekspan({
      projects: [
        { id: 'proj-parent', name: 'Parent project', colorToken: 'barA' },
        { id: 'proj-child', name: 'Child project', colorToken: 'barB' },
      ],
      items: [
        mkItem({ id: 'parent', projectId: 'proj-parent', rank: ranks[0]! }),
        mkItem({ id: 'child', parentId: 'parent', projectId: 'proj-child', rank: ranks[1]! }),
      ],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)

    const parentGroup = groups.find((g) => g.divider.projectId === 'proj-parent')!
    const childGroup = groups.find((g) => g.divider.projectId === 'proj-child')!
    expect(parentGroup.itemIds).toEqual(['parent'])
    expect(childGroup.itemIds).toEqual(['child'])

    const allIds = groups.flatMap((g) => g.itemIds)
    expect(allIds.sort()).toEqual(['child', 'parent'])
  })
})

describe('buildProjectView — empty project', () => {
  it('still yields a divider with a zeroed meta string', () => {
    const weekspan = createWeekspan({
      projects: [{ id: 'proj-fresh', name: 'Fresh project', colorToken: 'barA' }],
      items: [],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)
    const fresh = groups.find((g) => g.divider.projectId === 'proj-fresh')
    expect(fresh).toBeDefined()
    expect(fresh!.itemIds).toEqual([])
    expect(fresh!.divider.meta).toBe('0 done last week · 0 open')
  })
})

describe('buildProjectView — collapsed groups', () => {
  it('hides a group’s items but keeps its divider', () => {
    const view = buildProjectView(demoWeekspan(today), today, {
      collapsed: new Set(['proj-kitchen']),
    })
    const groups = groupsOf(view)
    const kitchen = groups.find((g) => g.divider.projectId === 'proj-kitchen')!
    expect(kitchen.divider.collapsed).toBe(true)
    expect(kitchen.itemIds).toEqual([])

    // Uncollapsed groups are unaffected.
    const work = groups.find((g) => g.divider.projectId === 'proj-work')!
    expect(work.divider.collapsed).toBe(false)
    expect(work.itemIds.length).toBeGreaterThan(0)
  })

  it('collapsing the null (no-project) group works the same way', () => {
    const view = buildProjectView(demoWeekspan(today), today, {
      collapsed: new Set<string | null>([null]),
    })
    const groups = groupsOf(view)
    const nullGroup = groups[groups.length - 1]!
    expect(nullGroup.divider.projectId).toBeNull()
    expect(nullGroup.divider.collapsed).toBe(true)
    expect(nullGroup.itemIds).toEqual([])
  })
})

describe('buildProjectView — meta counts', () => {
  it('counts done-last-week and open correctly for a known fixture', () => {
    const view = buildProjectView(demoWeekspan(today), today)
    const groups = groupsOf(view)

    // proj-kitchen: tiles (open), dishwasher (done 2026-08-23, inside last
    // week W34 = Aug 17-23), order-dishwasher (open), paint (open, no marks).
    const kitchen = groups.find((g) => g.divider.projectId === 'proj-kitchen')!
    expect(kitchen.divider.meta).toBe('1 done last week · 3 open')

    // proj-work: roadmap (open), perf (open).
    const work = groups.find((g) => g.divider.projectId === 'proj-work')!
    expect(work.divider.meta).toBe('0 done last week · 2 open')

    // proj-admin: passport (open).
    const admin = groups.find((g) => g.divider.projectId === 'proj-admin')!
    expect(admin.divider.meta).toBe('0 done last week · 1 open')

    // No project: water-plants — recurring, its only done mark (2026-08-19)
    // sits in a PAST period (W34), and the current period (W35) has no done
    // mark, so displayState is 'open', not 'finished' — it must not be
    // miscounted as "done last week" just because a stale done mark exists.
    const nullGroup = groups[groups.length - 1]!
    expect(nullGroup.divider.meta).toBe('0 done last week · 1 open')
  })

  it('a plain non-recurring done item done exactly at last week’s boundary counts', () => {
    const ranks = rankSequence(1)
    let item = mkItem({ id: 'done-boundary', projectId: 'p', rank: ranks[0]! })
    item = setDone(item, '2026-08-17') // Monday of W34 = last week's first day
    const weekspan = createWeekspan({
      projects: [{ id: 'p', name: 'P', colorToken: 'barA' }],
      items: [item],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)
    const p = groups.find((g) => g.divider.projectId === 'p')!
    expect(p.divider.meta).toBe('1 done last week · 0 open')
  })

  it('a done item from two weeks ago does not count as done last week', () => {
    const ranks = rankSequence(1)
    let item = mkItem({ id: 'done-old', projectId: 'p', rank: ranks[0]! })
    item = setDone(item, '2026-08-10') // W33, not last week
    const weekspan = createWeekspan({
      projects: [{ id: 'p', name: 'P', colorToken: 'barA' }],
      items: [item],
    })
    const view = buildProjectView(weekspan, today)
    const groups = groupsOf(view)
    const p = groups.find((g) => g.divider.projectId === 'p')!
    expect(p.divider.meta).toBe('0 done last week · 0 open')
  })
})

describe('buildProjectView — shared geometry with buildGrid', () => {
  const fixtures: Array<[string, Weekspan]> = [
    ['demo', demoWeekspan(today)],
    ['stress', stressWeekspan(today)],
    ['empty', emptyWeekspan(today)],
  ]

  for (const [name, weekspan] of fixtures) {
    it(`weeks and dates match buildGrid exactly, for ${name}`, () => {
      const grid = buildGrid(weekspan, today)
      const view = buildProjectView(weekspan, today)
      expect(view.weeks).toEqual(grid.weeks)
      expect(view.dates).toEqual(grid.dates)
      expect(view.today).toBe(grid.today)
      expect(view.currentWeek).toBe(grid.currentWeek)
    })

    it(`respects minWeeks the same way buildGrid does, for ${name}`, () => {
      const grid = buildGrid(weekspan, today, 8)
      const view = buildProjectView(weekspan, today, { minWeeks: 8 })
      expect(view.weeks).toEqual(grid.weeks)
      expect(view.dates).toEqual(grid.dates)
    })
  }
})
