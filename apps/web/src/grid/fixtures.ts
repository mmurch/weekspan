/**
 * Sample Weekspans for the grid view-model's tests, and for the app to render
 * before real file binding exists. Every fixture takes `today` as an argument
 * and anchors every date to it — none of them touch the system clock.
 */

import type { IsoDate, Item, Project, Weekspan } from '@weekspan/weekspan-core'
import {
  addDays,
  createWeekspan,
  rankBetween,
  rankSequence,
  setDone,
  setDue,
  weekday,
} from '@weekspan/weekspan-core'

interface ItemInit {
  id: string
  title: string
  notes?: string
  projectId?: string | null
  parentId?: string | null
  rank: string
}

function mkItem(init: ItemInit): Item {
  const item: Item = {
    id: init.id,
    title: init.title,
    rank: init.rank,
    marks: {},
  }
  if (init.notes !== undefined) item.notes = init.notes
  if (init.projectId !== undefined) item.projectId = init.projectId
  if (init.parentId !== undefined) item.parentId = init.parentId
  return item
}

/**
 * Mirrors `screenshots/01-3a-priority-grid.png`: three projects, a mix of
 * open/due/done items, a parent with one sub-item, and one recurring item
 * with both a generated occurrence and an explicit override.
 */
export function demoWeekspan(today: IsoDate): Weekspan {
  const projects: Project[] = [
    { id: 'proj-kitchen', name: 'Kitchen reno', colorToken: 'barA' },
    { id: 'proj-work', name: 'Work', colorToken: 'barB' },
    { id: 'proj-admin', name: 'Admin', colorToken: 'barC' },
  ]

  const ranks = rankSequence(7)

  let tiles = mkItem({
    id: 'item-tiles',
    title: 'choose stick-on tiles for kitchen',
    notes: '- oak-look, budget under $3/tile\n- check return policy\n- order samples first',
    projectId: 'proj-kitchen',
    rank: ranks[0]!,
  })
  tiles = setDue(tiles, addDays(today, 1))

  let roadmap = mkItem({
    id: 'item-roadmap',
    title: 'send Q3 roadmap draft to Priya',
    projectId: 'proj-work',
    rank: ranks[1]!,
  })
  roadmap = setDue(roadmap, today)

  let passport = mkItem({
    id: 'item-passport',
    title: 'renew passport — book appointment',
    projectId: 'proj-admin',
    rank: ranks[2]!,
  })
  passport = setDue(passport, addDays(today, 2))

  let dishwasher = mkItem({
    id: 'item-dishwasher',
    title: 'choose dishwasher model — quiet + counter depth',
    projectId: 'proj-kitchen',
    rank: ranks[3]!,
  })
  dishwasher = setDone(dishwasher, addDays(today, -3))

  let orderDishwasher = mkItem({
    id: 'item-order-dishwasher',
    title: 'order dishwasher',
    projectId: 'proj-kitchen',
    parentId: 'item-dishwasher',
    rank: ranks[4]!,
  })
  orderDishwasher = setDue(orderDishwasher, addDays(today, 3))

  const paint = mkItem({
    id: 'item-paint',
    title: 'choose paint color for front room',
    projectId: 'proj-kitchen',
    rank: ranks[5]!,
  })

  let perf = mkItem({
    id: 'item-perf',
    title: 'draft perf feedback — 4 reports',
    notes: '- Alex\n- Jamie\n- Priya\n- Sam',
    projectId: 'proj-work',
    rank: ranks[6]!,
  })
  perf = setDue(perf, addDays(today, 4))

  // Weekly recurrence anchored three weeks back, same weekday as `today`, so the
  // window shows both a generated occurrence (no explicit mark) and an explicit
  // override (an earlier occurrence marked done by hand).
  let waterPlants = mkItem({
    id: 'item-water-plants',
    title: 'water the plants',
    rank: rankBetween(ranks[6]!, null),
  })
  waterPlants = {
    ...waterPlants,
    recurrence: { freq: 'weekly', weekday: weekday(today), anchor: addDays(today, -21) },
  }
  waterPlants = setDone(waterPlants, addDays(today, -7))

  return createWeekspan({
    projects,
    items: [tiles, roadmap, passport, dishwasher, orderDishwasher, paint, perf, waterPlants],
    vacationDays: [addDays(today, 5)],
  })
}

/**
 * The torture case: one item with a ~200-character title sitting next to
 * several one-line items. Proves the grid keeps day columns aligned when a
 * row wraps to many lines — "wraps to multiple lines, never truncate" is the
 * design's hardest layout constraint.
 */
export function wrappingWeekspan(today: IsoDate): Weekspan {
  const ranks = rankSequence(4)

  const longTitle =
    'coordinate with the downstairs neighbor, the building super, and the HOA about ' +
    'rescheduling the water shutoff for the kitchen renovation, because the plumber can ' +
    'only do Tuesday mornings and the super needs 48 hours notice before any shutoff ' +
    'longer than two hours'

  let longItem = mkItem({ id: 'item-long', title: longTitle, rank: ranks[0]! })
  longItem = setDue(longItem, today)

  let a = mkItem({ id: 'item-a', title: 'buy milk', rank: ranks[1]! })
  a = setDue(a, addDays(today, 1))

  let b = mkItem({ id: 'item-b', title: 'call dentist', rank: ranks[2]! })
  b = setDue(b, addDays(today, 2))

  let c = mkItem({ id: 'item-c', title: 'renew library book', rank: ranks[3]! })
  c = setDone(c, addDays(today, -1))

  return createWeekspan({ items: [longItem, a, b, c] })
}

/** No projects, no items, no marks — the empty state. */
export function emptyWeekspan(_today: IsoDate): Weekspan {
  return createWeekspan()
}

/**
 * A deliberately oversized weekspan, for exercising scroll behaviour.
 *
 * Pushes both axes at once: ~60 items (vertical overflow past any viewport) with
 * a mix of one-line and heavily wrapping titles, several sub-items, notes, and
 * marks spread across the whole window so there is always something to see in
 * the far-right week columns when scrolled sideways.
 */
export function stressWeekspan(today: IsoDate): Weekspan {
  const projects: Project[] = [
    { id: 'house', name: 'Weymouth ground floor', colorToken: 'barA' },
    { id: 'work', name: 'Work', colorToken: 'barB' },
    { id: 'admin', name: 'Admin', colorToken: 'barC' },
  ]
  const projectIds = ['house', 'work', 'admin']

  const SHORT = [
    'buy milk',
    'call the plumber',
    'renew passport',
    'book dentist',
    'file expenses',
    'order printer paper',
    'return the drill',
    'pay council tax',
    'water the plants',
    'chase the invoice',
    'update the CV',
    'back up the laptop',
  ]

  const LONG = [
    'coordinate with the downstairs neighbour, the building super, and the HOA about rescheduling the water shutoff for the kitchen renovation, because the plumber can only do Tuesday mornings',
    'write up the quarterly planning doc covering headcount, the migration timeline, and the three open questions from last week that nobody has answered yet',
    'work out whether the extractor fan can vent through the side wall or whether it has to go up through the roof, which changes the cost by a factor of about four',
  ]

  const items: Item[] = []
  const ranks = rankSequence(70)
  let r = 0

  for (let i = 0; i < 60; i++) {
    const isLong = i % 9 === 4
    const title = isLong
      ? LONG[i % LONG.length]!
      : `${SHORT[i % SHORT.length]!} ${Math.floor(i / SHORT.length) + 1}`

    // Marks spread right across the window so far-right columns are not empty.
    const offset = (i % 25) - 8
    const marks: Item['marks'] = {}
    if (i % 5 === 0) marks[addDays(today, offset)] = { kind: 'done' }
    else if (i % 5 === 1) marks[addDays(today, Math.abs(offset))] = { kind: 'due' }
    else if (i % 7 === 3) {
      marks[addDays(today, offset)] = { kind: 'skip', provenance: 'deliberate' }
      marks[addDays(today, offset + 3)] = { kind: 'due' }
    }

    const item: Item = {
      id: `stress-${i}`,
      title,
      rank: ranks[r++]!,
      marks,
      projectId: projectIds[i % projectIds.length]!,
      ...(i % 11 === 2
        ? { notes: '- first supporting note\n- a second, slightly longer supporting note' }
        : {}),
    }
    items.push(item)

    // Every eighth root gets a child, to exercise nesting inside a long list.
    if (i % 8 === 6) {
      items.push({
        id: `stress-${i}-child`,
        title: `follow up on ${SHORT[i % SHORT.length]!}`,
        rank: ranks[r++]!,
        marks: { [addDays(today, (i % 11) - 3)]: { kind: 'due' } },
        parentId: `stress-${i}`,
        projectId: projectIds[i % projectIds.length]!,
      })
    }
  }

  return createWeekspan({ projects, items })
}
