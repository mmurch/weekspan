/**
 * `weekspan status` — see e2e.test.ts for the fixture style this copies:
 * `mkdtempSync` temp dir, `capture()` over `PassThrough` streams, `ctx()`
 * builder, `onDisk()` reader.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Weekspan } from '@weekspan/weekspan-core'
import type { CommandContext } from '../command.js'
import { createOutput, type Output } from '../output.js'
import { runInit } from './init.js'
import { runStatus } from './status.js'
import { runAdd } from './items.js'
import { runCellCommand } from './cells.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let weekspanPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'weekspan-status-'))
  weekspanPath = path.join(dir, 'l.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

interface Captured {
  out: Output
  stdout: () => string
  stderr: () => string
}

function capture(json = false): Captured {
  const o = new PassThrough()
  const e = new PassThrough()
  let outBuf = ''
  let errBuf = ''
  o.on('data', (c) => (outBuf += c.toString()))
  e.on('data', (c) => (errBuf += c.toString()))
  return {
    out: createOutput({ json, color: false, stdout: o, stderr: e }),
    stdout: () => outBuf,
    stderr: () => errBuf,
  }
}

function ctx(argv: string[], json = false): CommandContext {
  return { weekspanPath, json, today: TODAY, argv }
}

function onDisk(): Weekspan {
  return JSON.parse(readFileSync(weekspanPath, 'utf8')) as Weekspan
}

function writeDisk(l: Weekspan): void {
  writeFileSync(weekspanPath, JSON.stringify(l, null, 2), 'utf8')
}

async function init(): Promise<void> {
  await runInit(ctx([]), capture().out)
}

interface StatusJson {
  today: string
  currentWeek: string
  window: { from: string; to: string; weeks: string[] }
  counts: { open: number; finished: number; skipped: number; recurring: number }
  oldestUnclosedWeek: string | null
  closeable: boolean
  blockers: {
    explicit: Array<{ itemId: string; date: string; title: string }>
    generated: Array<{ itemId: string; date: string; title: string }>
  }
}

async function statusJson(): Promise<StatusJson> {
  const c = capture(true)
  await runStatus(ctx([], true), c.out)
  return JSON.parse(c.stdout()).data
}

describe('today, current week, and window range', () => {
  it('reports all three', async () => {
    await init()
    const data = await statusJson()
    expect(data.today).toBe(TODAY)
    expect(data.currentWeek).toBe('2026-W35')
    // closedThrough is null -> window starts at currentWeek - 1.
    expect(data.window.from).toBe('2026-W34')
    expect(data.window.to).toBe('2026-W37')

    const c = capture()
    await runStatus(ctx([]), c.out)
    expect(c.stdout()).toContain(`Today ${TODAY} (2026-W35)`)
    expect(c.stdout()).toContain('2026-W34 .. 2026-W37')
  })
})

describe('counts', () => {
  it('counts open/finished/skipped/recurring using derived state', async () => {
    await init()
    await runAdd(ctx(['open item']), capture().out)

    await runAdd(ctx(['finished item']), capture().out)
    const finishedId = onDisk().items.find((i) => i.title === 'finished item')!.id
    await runCellCommand(ctx([finishedId, TODAY]), 'done', capture().out)

    await runAdd(ctx(['skipped item']), capture().out)
    const skippedId = onDisk().items.find((i) => i.title === 'skipped item')!.id
    await runCellCommand(ctx([skippedId, TODAY]), 'skip', capture().out)

    await runAdd(ctx(['recurring item', '--recur', 'weekly', '--weekday', '3']), capture().out)

    const data = await statusJson()
    expect(data.counts).toEqual({ open: 2, finished: 1, skipped: 1, recurring: 1 })
  })
})

describe('blockers are split by kind', () => {
  it('an explicit due lands under explicit, a generated occurrence under generated', async () => {
    await init()

    // Explicit due inside the oldest unclosed week (2026-W34, Aug 17-23), left unresolved.
    await runAdd(ctx(['pay rent', '--due', '2026-08-19']), capture().out)
    const rentId = onDisk().items.find((i) => i.title === 'pay rent')!.id

    // Recurring item whose rule fires inside 2026-W34 with no explicit mark —
    // needs a backdated anchor, same trick as e2e.test.ts's auto-close case.
    await runAdd(ctx(['water plants', '--recur', 'weekly', '--weekday', '2']), capture().out)
    const plantsId = onDisk().items.find((i) => i.title === 'water plants')!.id
    const l = onDisk()
    const plants = l.items.find((i) => i.id === plantsId)!
    plants.recurrence = { freq: 'weekly', weekday: 2, anchor: '2026-08-01' }
    writeDisk(l)

    const data = await statusJson()
    expect(data.closeable).toBe(false)
    expect(data.oldestUnclosedWeek).toBe('2026-W34')

    expect(data.blockers.explicit).toEqual([
      { itemId: rentId, date: '2026-08-19', title: 'pay rent' },
    ])
    expect(data.blockers.generated).toEqual([
      { itemId: plantsId, date: '2026-08-18', title: 'water plants' },
    ])

    // Human text gives DIFFERENT advice for each kind.
    const c = capture()
    await runStatus(ctx([]), c.out)
    const human = c.stdout()
    expect(human).toMatch(/due\s+2026-08-19\s+pay rent.*complete or clear it/)
    expect(human).toMatch(/recurs\s+2026-08-18\s+water plants.*close-out --auto/)
  })
})

describe('a closeable past week', () => {
  it('says so, with no blockers', async () => {
    await init()
    const data = await statusJson()
    expect(data.oldestUnclosedWeek).toBe('2026-W34')
    expect(data.closeable).toBe(true)
    expect(data.blockers.explicit).toEqual([])
    expect(data.blockers.generated).toEqual([])

    const c = capture()
    await runStatus(ctx([]), c.out)
    expect(c.stdout()).toMatch(/2026-W34 is ready to close:\s+weekspan close-out/)
  })
})

describe('no past week awaiting close-out', () => {
  it('reports that cleanly', async () => {
    await init()
    const l = onDisk()
    // Already closed through the week before current: oldest unclosed IS the
    // current week, which is never "past".
    l.closedThrough = '2026-W34'
    writeDisk(l)

    const data = await statusJson()
    expect(data.oldestUnclosedWeek).toBe('2026-W35')
    expect(data.closeable).toBe(false)
    expect(data.blockers.explicit).toEqual([])
    expect(data.blockers.generated).toEqual([])

    const c = capture()
    await runStatus(ctx([]), c.out)
    expect(c.stdout()).toContain('No past week awaiting close-out.')
  })
})

describe('--json shape', () => {
  it('has blockers.explicit and blockers.generated as separate arrays', async () => {
    await init()
    const data = await statusJson()
    expect(Array.isArray(data.blockers.explicit)).toBe(true)
    expect(Array.isArray(data.blockers.generated)).toBe(true)
  })
})

describe('status never writes', () => {
  it('leaves the file byte-identical before and after', async () => {
    await init()
    await runAdd(ctx(['a task', '--due', '2026-08-19']), capture().out)
    const before = readFileSync(weekspanPath, 'utf8')

    await runStatus(ctx([]), capture().out)
    await runStatus(ctx([], true), capture(true).out)

    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })
})
