/**
 * End-to-end: real temp files, real commands, real serialized output.
 *
 * `weekspan-core` is pure and covered by its own suite; these tests exist for the
 * surface that only appears once commands, file I/O and the dispatcher are
 * combined — which is where every bug found so far has actually lived.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Weekspan } from '@weekspan/weekspan-core'
import type { CommandContext } from './command.js'
import { createOutput, type Output } from './output.js'
import { stripGlobals } from './index.js'
import { runInit } from './commands/init.js'
import { runList } from './commands/list.js'
import { runStatus } from './commands/status.js'
import { runAdd, runMove, runRm } from './commands/items.js'
import { runCellCommand } from './commands/cells.js'
import { runCloseOut } from './commands/closeout.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let weekspanPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'weekspan-e2e-'))
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

async function init(): Promise<void> {
  await runInit(ctx([]), capture().out)
}

describe('stripGlobals', () => {
  it('removes global flags and their values from a command argv', () => {
    // Regression: an undeclared `--weekspan /path` did not vanish under
    // `strict: false` — parseArgs returned the VALUE as a positional, so
    // `add "buy milk" --weekspan ~/x.json` created an item titled
    // "buy milk /Users/me/x.json".
    expect(stripGlobals(['buy milk', '--weekspan', '/tmp/x.json'])).toEqual(['buy milk'])
    expect(stripGlobals(['buy milk', '--today', '2026-01-01', '--json'])).toEqual(['buy milk'])
    expect(stripGlobals(['buy milk', '--weekspan=/tmp/x.json'])).toEqual(['buy milk'])
  })

  it('leaves command-specific flags untouched', () => {
    expect(stripGlobals(['x', '--due', 'thu', '--project', 'work'])).toEqual([
      'x',
      '--due',
      'thu',
      '--project',
      'work',
    ])
  })
})

describe('a full session', () => {
  it('init → add → due → done → status → close-out', async () => {
    await init()
    expect(existsSync(weekspanPath)).toBe(true)
    expect(existsSync(path.join(dir, 'weekspan.schema.json'))).toBe(true)

    const added = capture()
    await runAdd(ctx(['choose tiles', '--due', 'thu']), added.out)
    const id = onDisk().items[0]!.id
    expect(added.stdout()).toContain(id)
    expect(onDisk().items[0]!.marks['2026-08-27']!.kind).toBe('due')

    await runCellCommand(ctx([id, '2026-08-27']), 'done', capture().out)
    expect(onDisk().items[0]!.marks['2026-08-27']!.kind).toBe('done')

    // Nothing has happened before this week yet, so there is nothing to close
    // and the window starts at W35 — a brand-new ledger does not open claiming
    // it is already a week behind.
    const fresh = capture()
    await runStatus(ctx([]), fresh.out)
    expect(fresh.stdout()).toContain('2026-W35')
    expect(fresh.stdout()).not.toContain('2026-W34')

    // Give the session some history: a chunk of the same item done last week.
    await runCellCommand(ctx([id, '2026-08-19']), 'done', capture().out)

    const status = capture()
    await runStatus(ctx([]), status.out)
    expect(status.stdout()).toContain('2026-W34')

    const closed = capture()
    await runCloseOut(ctx([]), closed.out)
    expect(onDisk().closedThrough).toBe('2026-W34')
  })
})

describe('writes are precise', () => {
  it('a no-op move writes nothing at all', async () => {
    await init()
    await runAdd(ctx(['first']), capture().out)
    await runAdd(ctx(['second']), capture().out)
    const [a, b] = onDisk().items
    const before = readFileSync(weekspanPath, 'utf8')

    const moved = capture()
    await runMove(ctx([b!.id, '--after', a!.id]), moved.out)

    // Already in position: no rank change, therefore no write and no diff in a
    // synced folder. This is the whole point of minimalMoveRank returning null.
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
    expect(moved.stdout()).toMatch(/already in position/)
  })

  it('clearing an unmarked cell leaves the file byte-identical', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const id = onDisk().items[0]!.id
    const before = readFileSync(weekspanPath, 'utf8')

    await runCellCommand(ctx([id, '2026-08-27']), 'clear', capture().out)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })

  it('read commands never write', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const before = readFileSync(weekspanPath, 'utf8')
    await runList(ctx([]), capture().out)
    await runStatus(ctx([]), capture().out)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })
})

describe('skip provenance', () => {
  it('the CLI always writes deliberate, never auto', async () => {
    // `auto` is reserved for autoClose during catch-up. A CLI-written `auto`
    // would make a deliberate dodge indistinguishable from a long absence.
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const id = onDisk().items[0]!.id
    await runCellCommand(ctx([id, '2026-08-26']), 'skip', capture().out)

    const mark = onDisk().items[0]!.marks['2026-08-26']!
    expect(mark.kind).toBe('skip')
    expect(mark.kind === 'skip' && mark.provenance).toBe('deliberate')
  })

  it('auto-close writes auto provenance for lapsed recurring occurrences', async () => {
    await init()
    await runAdd(ctx(['water plants', '--recur', 'weekly', '--weekday', '1']), capture().out)

    // Backdate the anchor so occurrences exist in past weeks.
    const l = onDisk()
    l.items[0]!.recurrence = { freq: 'weekly', weekday: 1, anchor: '2026-07-01' }
    l.closedThrough = '2026-W30'
    writeFileSync(weekspanPath, JSON.stringify(l, null, 2), 'utf8')

    const auto = capture()
    await runCloseOut(ctx(['--auto']), auto.out)

    const marks = Object.values(onDisk().items[0]!.marks)
    expect(marks.length).toBeGreaterThan(0)
    expect(marks.every((m) => m.kind === 'skip' && m.provenance === 'auto')).toBe(true)
    expect(auto.stdout()).toMatch(/Auto-skipped/)
  })
})

describe('refusals protect data', () => {
  it('rm refuses without --force and writes nothing', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const id = onDisk().items[0]!.id
    const before = readFileSync(weekspanPath, 'utf8')

    await expect(runRm(ctx([id]), capture().out)).rejects.toThrow(/--force/)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })

  it('an ambiguous item reference errors instead of guessing', async () => {
    await init()
    await runAdd(ctx(['choose tiles']), capture().out)
    await runAdd(ctx(['choose paint']), capture().out)
    const before = readFileSync(weekspanPath, 'utf8')

    const c = capture()
    const code = await runCellCommand(ctx(['choose', '2026-08-26']), 'done', c.out)
    expect(code).toBe(2) // EXIT.USAGE
    expect(c.stderr()).toMatch(/matches 2 items/)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })

  it('init refuses to overwrite an existing weekspan', async () => {
    await init()
    await expect(runInit(ctx([]), capture().out)).rejects.toThrow(/already exists/)
  })
})

describe('--json output', () => {
  it('emits one parseable object on stdout with an ok envelope', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)

    const c = capture(true)
    await runStatus(ctx([], true), c.out)
    const parsed = JSON.parse(c.stdout())
    expect(parsed.ok).toBe(true)
    expect(parsed.data.currentWeek).toBe('2026-W35')
    expect(parsed.data.blockers).toHaveProperty('explicit')
    expect(parsed.data.blockers).toHaveProperty('generated')
  })

  it('keeps stdout parseable even when a warning is emitted', async () => {
    await init()
    const c = capture(true)
    c.out.warn('something noteworthy')
    await runList(ctx([], true), c.out)
    expect(() => JSON.parse(c.stdout())).not.toThrow()
    expect(c.stderr()).toContain('something noteworthy')
  })
})
