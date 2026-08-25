/**
 * Unit tests for `close-out` / `close-out --auto` (closeout.ts).
 *
 * Fixture style copied from ../e2e.test.ts: real temp files, `capture()`
 * wraps `createOutput` over in-memory `PassThrough` streams, `ctx()` builds
 * a `CommandContext`, `onDisk()` reads the weekspan back from disk.
 *
 * Unlike cells.ts, closeout.ts does NOT catch `CliError` — a blocked close
 * throws, so tests assert with `rejects.toThrow` / try-catch on `.code`
 * rather than a returned exit code.
 *
 * Week arithmetic for TODAY = '2026-08-26' (Wednesday, 2026-W35):
 *   2026-W32  2026-08-03 .. 2026-08-09
 *   2026-W33  2026-08-10 .. 2026-08-16
 *   2026-W34  2026-08-17 .. 2026-08-23   (oldest unclosed by default)
 *   2026-W35  2026-08-24 .. 2026-08-30   (current — never closeable)
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ArchiveFile, Weekspan } from '@weekspan/weekspan-core'
import type { CommandContext } from '../command.js'
import { archiveDir } from '../config.js'
import { createOutput, type Output } from '../output.js'
import { CliError, EXIT } from '../exit.js'
import { runInit } from './init.js'
import { runAdd } from './items.js'
import { runCellCommand } from './cells.js'
import { runCloseOut } from './closeout.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let weekspanPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'weekspan-closeout-'))
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

function writeWeekspan(l: Weekspan): void {
  writeFileSync(weekspanPath, JSON.stringify(l, null, 2), 'utf8')
}

function archivePathFor(week: string): string {
  return path.join(archiveDir(weekspanPath), `${week}.json`)
}

function readArchive(week: string): ArchiveFile {
  return JSON.parse(readFileSync(archivePathFor(week), 'utf8')) as ArchiveFile
}

async function init(): Promise<void> {
  await runInit(ctx([]), capture().out)
}

async function addItem(title: string): Promise<string> {
  await runAdd(ctx([title]), capture().out)
  const items = onDisk().items
  return items[items.length - 1]!.id
}

/** Runs `fn`, expects it to throw a `CliError`, and returns that error. */
async function expectCliError(fn: () => Promise<unknown>): Promise<CliError> {
  try {
    await fn()
  } catch (err) {
    expect(err).toBeInstanceOf(CliError)
    return err as CliError
  }
  throw new Error('expected fn() to throw a CliError, but it did not throw')
}

describe('a week blocked by an explicit due', () => {
  it('is refused with EXIT.CONFLICT, naming the item and saying to complete or clear it', async () => {
    await init()
    const id = await addItem('pay rent')
    await runCellCommand(ctx([id, '2026-08-20']), 'due', capture().out)

    const before = readFileSync(weekspanPath, 'utf8')
    const err = await expectCliError(() => runCloseOut(ctx([]), capture().out))

    expect(err.code).toBe(EXIT.CONFLICT)
    expect(err.message).toContain('pay rent')
    expect(err.message).toContain(id)
    expect(err.message).toMatch(/complete or clear it/)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })
})

describe('a week blocked only by a generated recurring occurrence', () => {
  it('is refused, and the message suggests --auto (a different remedy than an explicit due)', async () => {
    await init()
    const id = await addItem('water plants')
    // Give `water plants` a weekly recurrence, then backdate its anchor so an
    // occurrence actually falls inside W34 (2026-08-17 .. 2026-08-23) — a
    // fresh --recur's anchor defaults to `today`, which is in W35.
    const l = onDisk()
    const item = l.items.find((i) => i.id === id)!
    item.recurrence = { freq: 'weekly', weekday: 4, anchor: '2026-07-01' } // Thursdays
    // closedThrough W33 so W34 is the oldest unclosed week. A ledger with no
    // history at all now starts its window at the CURRENT week, which would
    // make close-out refuse W35 as "the current week" and never reach the
    // recurring-occurrence message this test is about.
    l.closedThrough = '2026-W33'
    writeWeekspan(l)

    const before = readFileSync(weekspanPath, 'utf8')
    const err = await expectCliError(() => runCloseOut(ctx([]), capture().out))

    expect(err.code).toBe(EXIT.CONFLICT)
    expect(err.message).toContain('water plants')
    expect(err.message).toContain(id)
    expect(err.message).toMatch(/--auto/)
    // The two blocker kinds must read differently — this is the bug the test guards.
    expect(err.message).not.toMatch(/complete or clear it/)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })
})

describe('refusing to close the current week', () => {
  it('throws EXIT.CONFLICT naming the current week', async () => {
    await init()
    const l = onDisk()
    l.closedThrough = '2026-W34' // caught up: oldest unclosed is now W35, the current week
    writeWeekspan(l)

    const before = readFileSync(weekspanPath, 'utf8')
    const err = await expectCliError(() => runCloseOut(ctx([]), capture().out))

    expect(err.code).toBe(EXIT.CONFLICT)
    expect(err.message).toContain('2026-W35')
    expect(err.message).toMatch(/current week/)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })
})

describe('a successful close', () => {
  it('writes archive/<week>.json, advances closedThrough, and removes archived items', async () => {
    await init()
    const id = await addItem('clean garage')
    await runCellCommand(ctx([id, '2026-08-20']), 'done', capture().out) // finished, inside W34

    const code = await runCloseOut(ctx([]), capture().out)
    expect(code).toBe(EXIT.OK)

    const after = onDisk()
    expect(after.closedThrough).toBe('2026-W34')
    expect(after.items.find((i) => i.id === id)).toBeUndefined()

    const archivePath = archivePathFor('2026-W34')
    expect(existsSync(archivePath)).toBe(true)
    const archive = readArchive('2026-W34')
    expect(archive.week).toBe('2026-W34')
    expect(archive.items).toHaveLength(1)
    expect(archive.items[0]!.id).toBe(id)
    expect(archive.items[0]!.title).toBe('clean garage')
  })
})

describe('a finished item whose latest mark falls in a later week', () => {
  it('is not archived and still appears in the weekspan afterwards', async () => {
    await init()
    const id = await addItem('big project')
    // Only mark is `done`, dated in W35 (the current week) — after W34's end
    // (2026-08-23). Finished, but not archivable when closing W34.
    await runCellCommand(ctx([id, '2026-08-25']), 'done', capture().out)

    // W34 must be the oldest unclosed week for this to be a test about
    // archivability rather than about which week close-out picks.
    const seed = onDisk()
    seed.closedThrough = '2026-W33'
    writeWeekspan(seed)

    const code = await runCloseOut(ctx([]), capture().out)
    expect(code).toBe(EXIT.OK)

    const after = onDisk()
    expect(after.closedThrough).toBe('2026-W34')
    const survivor = after.items.find((i) => i.id === id)
    expect(survivor).toBeDefined()
    expect(survivor!.marks['2026-08-25']).toEqual({ kind: 'done' })

    const archive = readArchive('2026-W34')
    expect(archive.items.find((i) => i.id === id)).toBeUndefined()
  })
})

describe('a recurring item', () => {
  it('is never archived, however many done marks it has', async () => {
    await init()
    const id = await addItem('take vitamins')
    const l = onDisk()
    const item = l.items.find((i) => i.id === id)!
    item.recurrence = { freq: 'weekly', weekday: 4, anchor: '2026-07-01' } // Thursdays
    // closedThrough W33 so W34 is the oldest unclosed week. A ledger with no
    // history at all now starts its window at the CURRENT week, which would
    // make close-out refuse W35 as "the current week" and never reach the
    // recurring-occurrence message this test is about.
    l.closedThrough = '2026-W33'
    writeWeekspan(l)

    // Resolve the one generated occurrence inside W34 (2026-08-20, Thursday)
    // with an explicit done mark so the week is closeable.
    await runCellCommand(ctx([id, '2026-08-20']), 'done', capture().out)

    const code = await runCloseOut(ctx([]), capture().out)
    expect(code).toBe(EXIT.OK)

    const after = onDisk()
    expect(after.closedThrough).toBe('2026-W34')
    expect(after.items.find((i) => i.id === id)).toBeDefined()

    const archive = readArchive('2026-W34')
    expect(archive.items.find((i) => i.id === id)).toBeUndefined()
  })
})

describe('--auto across a multi-week gap', () => {
  it('closes every week, writes one archive per week, and every auto-skip carries provenance: auto', async () => {
    await init()
    const id = await addItem('water plants')
    const l = onDisk()
    const item = l.items.find((i) => i.id === id)!
    item.recurrence = { freq: 'weekly', weekday: 4, anchor: '2026-07-01' } // Thursdays
    l.closedThrough = '2026-W31' // oldest unclosed becomes W32 -> gap of W32, W33, W34
    writeWeekspan(l)

    const c = capture()
    const code = await runCloseOut(ctx(['--auto']), c.out)
    expect(code).toBe(EXIT.OK)
    expect(c.stdout()).toMatch(/Auto-skipped/)

    const after = onDisk()
    expect(after.closedThrough).toBe('2026-W34')

    for (const week of ['2026-W32', '2026-W33', '2026-W34']) {
      expect(existsSync(archivePathFor(week))).toBe(true)
    }

    // Recurring item is never archived: it must still be in the weekspan, with
    // one auto-skip per Thursday occurrence that fell inside the gap.
    const survivor = after.items.find((i) => i.id === id)!
    expect(survivor).toBeDefined()
    const expectedDates = ['2026-08-06', '2026-08-13', '2026-08-20']
    for (const date of expectedDates) {
      expect(survivor.marks[date]).toEqual({ kind: 'skip', provenance: 'auto' })
    }

    const raw = readFileSync(weekspanPath, 'utf8')
    expect(raw).toContain('"provenance": "auto"')
    expect(raw).not.toContain('"provenance": "deliberate"')
  })
})

describe('--auto on an already-current weekspan', () => {
  it('is a clean no-op', async () => {
    await init()
    const l = onDisk()
    l.closedThrough = '2026-W34' // caught up: oldest unclosed is W35, the current week
    writeWeekspan(l)
    const before = readFileSync(weekspanPath, 'utf8')

    const c = capture()
    const code = await runCloseOut(ctx(['--auto']), c.out)
    expect(code).toBe(EXIT.OK)
    expect(c.stdout()).toMatch(/Nothing to close/)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
    expect(existsSync(archiveDir(weekspanPath))).toBe(false)
  })
})

describe('archive-before-weekspan ordering', () => {
  it('the archive file exists and its contents match what was removed from the weekspan', async () => {
    await init()
    const keepId = await addItem('ongoing task') // never marked; stays open, never archived
    const goneId = await addItem('clean garage')
    await runCellCommand(ctx([goneId, '2026-08-20']), 'done', capture().out)

    const before = onDisk()

    const code = await runCloseOut(ctx([]), capture().out)
    expect(code).toBe(EXIT.OK)

    const after = onDisk()
    const removedIds = before.items
      .map((i) => i.id)
      .filter((removedId) => !after.items.some((i) => i.id === removedId))
    expect(removedIds).toEqual([goneId])
    expect(after.items.some((i) => i.id === keepId)).toBe(true)

    const archive = readArchive('2026-W34')
    expect(archive.items.map((i) => i.id)).toEqual(removedIds)
    const removedItem = before.items.find((i) => i.id === goneId)!
    expect(archive.items[0]).toEqual(removedItem)
  })
})
