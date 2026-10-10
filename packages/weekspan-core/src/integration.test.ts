/**
 * End-to-end composition test.
 *
 * Every other test file exercises one module. This one walks a realistic session
 * across all of them, because the failures that matter most in a package like this
 * are the ones that live in the seams — a serializer that drops a field the merge
 * relies on, or a close-out that archives something the window still wants to draw.
 */
import {
  autoClose,
  closeWeek,
  computeWindow,
  displayState,
  effectiveMark,
  isCloseable,
  isFinished,
  merge,
  parse,
  rankSequence,
  serialize,
  setDone,
  setDue,
} from './index.js'
import { AGENT_WARNING, SCHEMA_URI, setSkip, unresolvedInWeek } from './index.js'
import type { Item, Weekspan } from './index.js'

const TODAY = '2026-08-26' // Wednesday of 2026-W35 — the day the mockup depicts

function baseWeekspan(): Weekspan {
  const [r1, r2, r3, r4] = rankSequence(4) as [string, string, string, string]
  const items: Item[] = [
    { id: 'tiles', title: 'choose stick-on tiles for kitchen', rank: r1, marks: {}, projectId: 'weymouth' },
    { id: 'roadmap', title: 'send Q3 roadmap draft to Priya', rank: r2, marks: {}, projectId: 'work' },
    { id: 'passport', title: 'renew passport — book appointment', rank: r3, marks: {}, projectId: 'admin' },
    {
      id: 'plants',
      title: 'water the plants',
      rank: r4,
      marks: {},
      projectId: 'admin',
      recurrence: { freq: 'weekly', weekday: 1, anchor: '2026-01-05' },
    },
  ]
  return {
    version: 1,
    closedThrough: '2026-W33',
    vacationDays: [],
    projects: [
      { id: 'admin', name: 'Admin', colorToken: 'barC' },
      { id: 'weymouth', name: 'Weymouth ground floor', colorToken: 'barA' },
      { id: 'work', name: 'Work', colorToken: 'barB' },
    ],
    items,
  }
}

describe('a realistic session, end to end', () => {
  it('round-trips a populated weekspan through the file format unchanged', () => {
    const l = baseWeekspan()
    // serialize always stamps $schema/$agent, so round-trip is identity only once the
    // header exists — which it always does for any weekspan that came off disk.
    expect(parse(serialize(l))).toEqual({ ...l, $schema: SCHEMA_URI, $agent: AGENT_WARNING })
    // And is byte-stable, so re-saving an untouched weekspan produces no diff.
    expect(serialize(parse(serialize(l)))).toBe(serialize(l))
  })

  it('draws the window the design mockup shows', () => {
    const w = computeWindow(baseWeekspan(), TODAY)
    expect(w.weeks.map((x) => x.week)).toEqual(['2026-W34', '2026-W35', '2026-W36', '2026-W37'])
    expect(w.currentWeek).toBe('2026-W35')
    expect(w.weeks[0]!.isPast).toBe(true)
    expect(w.weeks[0]!.isOldestUnclosed).toBe(true)
    expect(w.weeks[1]!.isCurrent).toBe(true)
  })

  it('generates recurring cells without ever writing them to the file', () => {
    const l = baseWeekspan()
    const plants = l.items.find((i) => i.id === 'plants')!
    // Mondays in the window are generated as due...
    expect(effectiveMark(plants, '2026-08-24', [])?.kind).toBe('due')
    expect(effectiveMark(plants, '2026-08-31', [])?.kind).toBe('due')
    expect(effectiveMark(plants, '2026-08-25', [])).toBeUndefined()
    // ...but the serialized file still holds zero marks for it.
    expect(JSON.parse(serialize(l)).items.find((i: Item) => i.id === 'plants').marks).toEqual({})
  })

  it('chunks work across sessions and finishes on the last one', () => {
    let tiles = baseWeekspan().items[0]!
    tiles = setDue(tiles, '2026-08-27')
    tiles = setDone(tiles, '2026-08-25')
    // Worked Tuesday, still due Thursday — not finished yet.
    expect(isFinished(tiles)).toBe(false)
    expect(displayState(tiles, TODAY)).toBe('open')

    tiles = setDone(tiles, '2026-08-27')
    expect(isFinished(tiles)).toBe(true)
    expect(displayState(tiles, TODAY)).toBe('finished')
  })

  it('blocks close-out on a real due, and releases once it is resolved', () => {
    const l = baseWeekspan()
    // Put an explicit due in the past week on the passport item.
    l.items = l.items.map((i) =>
      i.id === 'passport' ? setDue(i, '2026-08-20') : i,
    )
    const blocked = isCloseable(l, '2026-W34', TODAY)
    expect(blocked.closeable).toBe(false)
    expect(blocked.blockers.some((b) => b.itemId === 'passport' && b.kind === 'explicit')).toBe(true)
    // The weekly item's Monday occurrence blocks a MANUAL close too — that is the
    // forcing function that makes you look at it and declare.
    expect(blocked.blockers.some((b) => b.itemId === 'plants' && b.kind === 'generated')).toBe(true)

    l.items = l.items.map((i) => (i.id === 'passport' ? setDone(i, '2026-08-20') : i))
    expect(isCloseable(l, '2026-W34', TODAY).closeable).toBe(false) // plants still pending

    l.items = l.items.map((i) => (i.id === 'plants' ? setSkip(i, '2026-08-17', 'deliberate') : i))
    expect(isCloseable(l, '2026-W34', TODAY).closeable).toBe(true)
  })

  it('archives the finished item and keeps the recurring one forever', () => {
    const l = baseWeekspan()
    l.items = l.items.map((i) =>
      i.id === 'passport'
        ? setDone(i, '2026-08-20')
        : i.id === 'plants'
          ? setSkip(i, '2026-08-17', 'deliberate')
          : i,
    )

    const { weekspan: after, archive } = closeWeek(l, '2026-W34', TODAY)
    expect(archive.items.map((i) => i.id)).toEqual(['passport'])
    expect(after.items.map((i) => i.id).sort()).toEqual(['plants', 'roadmap', 'tiles'])
    expect(after.closedThrough).toBe('2026-W34')
    // A standing commitment is never finished, so it is never swept away.
    expect(after.items.some((i) => i.id === 'plants')).toBe(true)
  })

  it('returns from a long absence without a wall of clicks', () => {
    // Three months untouched, with only the weekly recurring item outstanding.
    const l = baseWeekspan()
    l.closedThrough = '2026-W20'
    const { weekspan: after, weeksClosed, autoSkipped } = autoClose(l, TODAY)

    expect(weeksClosed.length).toBeGreaterThan(10)
    expect(after.closedThrough).toBe('2026-W34')
    expect(autoSkipped).toBe(weeksClosed.length)

    // Every auto-skip is labelled as such, so a skip-streak feature can ignore them
    // rather than reading three months of absence as three months of avoidance.
    const plants = after.items.find((i) => i.id === 'plants')!
    const marks = Object.values(plants.marks)
    expect(marks.every((m) => m.kind === 'skip')).toBe(true)
    const provenances = marks.map((m) => (m.kind === 'skip' ? m.provenance : undefined))
    expect(provenances.every((p) => p === 'auto')).toBe(true)
    expect(provenances).toHaveLength(autoSkipped)
  })

  it('survives a laptop and a phone editing the same item at once', () => {
    const base = baseWeekspan()
    const ours = parse(serialize(base))
    const theirs = parse(serialize(base))

    // Laptop completes the roadmap draft; phone schedules the passport call.
    ours.items = ours.items.map((i) => (i.id === 'roadmap' ? setDone(i, '2026-08-26') : i))
    theirs.items = theirs.items.map((i) => (i.id === 'passport' ? setDue(i, '2026-08-28') : i))

    const { merged, conflicts } = merge(base, ours, theirs)
    expect(conflicts).toHaveLength(0)
    expect(merged.items.find((i) => i.id === 'roadmap')!.marks['2026-08-26']!.kind).toBe('done')
    expect(merged.items.find((i) => i.id === 'passport')!.marks['2026-08-28']!.kind).toBe('due')
    // And the merged result is still a valid weekspan file.
    expect(parse(serialize(merged))).toEqual(merged)
  })
})
