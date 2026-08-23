/**
 * Unit tests for `done` / `due` / `skip` / `clear` (cells.ts).
 *
 * Fixture style copied from ../e2e.test.ts: real temp files, `capture()`
 * wraps `createOutput` over in-memory `PassThrough` streams, `ctx()` builds
 * a `CommandContext`, `onDisk()` reads the ledger back from disk.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Ledger } from '@murch-todo/ledger-core'
import { displayState } from '@murch-todo/ledger-core'
import type { CommandContext } from '../command.js'
import { createOutput, type Output } from '../output.js'
import { EXIT } from '../exit.js'
import { runInit } from './init.js'
import { runAdd } from './items.js'
import { runCellCommand } from './cells.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let ledgerPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ledger-cells-'))
  ledgerPath = path.join(dir, 'l.json')
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
  return { ledgerPath, json, today: TODAY, argv }
}

function onDisk(): Ledger {
  return JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger
}

async function init(): Promise<void> {
  await runInit(ctx([]), capture().out)
}

/** Add a fresh item and return its id. */
async function addItem(title = 'a task'): Promise<string> {
  await runAdd(ctx([title]), capture().out)
  const items = onDisk().items
  return items[items.length - 1]!.id
}

describe('done / due / skip / clear — fresh item, on-disk marks', () => {
  it('done writes a done mark on the given date', async () => {
    await init()
    const id = await addItem()
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'done', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks['2026-08-27']).toEqual({ kind: 'done' })
  })

  it('due writes a due mark on the given date', async () => {
    await init()
    const id = await addItem()
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'due', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks['2026-08-27']).toEqual({ kind: 'due' })
  })

  it('skip writes a skip mark on the given date', async () => {
    await init()
    const id = await addItem()
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'skip', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks['2026-08-27']).toEqual({
      kind: 'skip',
      provenance: 'deliberate',
    })
  })

  it('clear removes a previously written mark', async () => {
    await init()
    const id = await addItem()
    await runCellCommand(ctx([id, '2026-08-27']), 'done', capture().out)
    expect(onDisk().items[0]!.marks['2026-08-27']).toBeDefined()

    const code = await runCellCommand(ctx([id, '2026-08-27']), 'clear', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks['2026-08-27']).toBeUndefined()
  })
})

describe('date defaults to today', () => {
  it('done with no date argument marks today', async () => {
    await init()
    const id = await addItem()
    const code = await runCellCommand(ctx([id]), 'done', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks[TODAY]).toEqual({ kind: 'done' })
  })

  it('skip with no date argument marks today', async () => {
    await init()
    const id = await addItem()
    const code = await runCellCommand(ctx([id]), 'skip', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks[TODAY]).toEqual({ kind: 'skip', provenance: 'deliberate' })
  })

  it('clear with no date argument clears today', async () => {
    await init()
    const id = await addItem()
    await runCellCommand(ctx([id]), 'done', capture().out)
    const code = await runCellCommand(ctx([id]), 'clear', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items[0]!.marks[TODAY]).toBeUndefined()
  })

  it('due requires an explicit date and errors without one', async () => {
    await init()
    const id = await addItem()
    const before = readFileSync(ledgerPath, 'utf8')

    const c = capture()
    const code = await runCellCommand(ctx([id]), 'due', c.out)
    expect(code).toBe(EXIT.USAGE)
    expect(c.stderr()).toMatch(/Missing date/)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('one mark per cell', () => {
  it('due then done on the SAME date leaves exactly one mark, of kind done', async () => {
    await init()
    const id = await addItem()
    await runCellCommand(ctx([id, '2026-08-27']), 'due', capture().out)
    expect(onDisk().items[0]!.marks['2026-08-27']!.kind).toBe('due')

    await runCellCommand(ctx([id, '2026-08-27']), 'done', capture().out)
    const marks = onDisk().items[0]!.marks
    expect(Object.keys(marks)).toEqual(['2026-08-27'])
    expect(marks['2026-08-27']).toEqual({ kind: 'done' })
  })
})

describe('skip provenance', () => {
  it('always writes deliberate — the raw JSON on disk never says auto', async () => {
    await init()
    const id = await addItem()
    await runCellCommand(ctx([id, '2026-08-26']), 'skip', capture().out)

    const raw = readFileSync(ledgerPath, 'utf8')
    expect(raw).toContain('"provenance": "deliberate"')
    expect(raw).not.toContain('"provenance": "auto"')

    const mark = onDisk().items.find((i) => i.id === id)!.marks['2026-08-26']!
    expect(mark.kind).toBe('skip')
    expect(mark.kind === 'skip' && mark.provenance).toBe('deliberate')
  })
})

describe('vacation days', () => {
  async function withVacationDay(date: string): Promise<string> {
    await init()
    const id = await addItem()
    const l = onDisk()
    l.vacationDays = [date]
    writeFileSync(ledgerPath, JSON.stringify(l, null, 2), 'utf8')
    return id
  }

  it('due is refused with EXIT.CONFLICT and writes nothing', async () => {
    const id = await withVacationDay('2026-08-27')
    const before = readFileSync(ledgerPath, 'utf8')

    const c = capture()
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'due', c.out)
    expect(code).toBe(EXIT.CONFLICT)
    expect(c.stderr()).toMatch(/vacation day/)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('done is refused with EXIT.CONFLICT and writes nothing', async () => {
    const id = await withVacationDay('2026-08-27')
    const before = readFileSync(ledgerPath, 'utf8')

    const c = capture()
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'done', c.out)
    expect(code).toBe(EXIT.CONFLICT)
    expect(c.stderr()).toMatch(/vacation day/)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('skip is still permitted on a vacation day', async () => {
    const id = await withVacationDay('2026-08-27')
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'skip', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items.find((i) => i.id === id)!.marks['2026-08-27']).toEqual({
      kind: 'skip',
      provenance: 'deliberate',
    })
  })

  it('clear is still permitted on a vacation day', async () => {
    const id = await withVacationDay('2026-08-27')
    // Put a skip mark there first (allowed), then clear it (also allowed).
    await runCellCommand(ctx([id, '2026-08-27']), 'skip', capture().out)
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'clear', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(onDisk().items.find((i) => i.id === id)!.marks['2026-08-27']).toBeUndefined()
  })
})

describe('clear on an unmarked date', () => {
  it('leaves the file byte-identical', async () => {
    await init()
    const id = await addItem()
    const before = readFileSync(ledgerPath, 'utf8')

    const code = await runCellCommand(ctx([id, '2026-08-27']), 'clear', capture().out)
    expect(code).toBe(EXIT.OK)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('resolution failures write nothing', () => {
  it('an unknown item fails without writing', async () => {
    await init()
    await addItem('a task')
    const before = readFileSync(ledgerPath, 'utf8')

    const c = capture()
    const code = await runCellCommand(ctx(['no-such-item', '2026-08-27']), 'done', c.out)
    expect(code).toBe(EXIT.USAGE)
    expect(c.stderr()).toMatch(/No item matching/)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('an ambiguous item fails without writing', async () => {
    await init()
    await addItem('choose tiles')
    await addItem('choose paint')
    const before = readFileSync(ledgerPath, 'utf8')

    const c = capture()
    const code = await runCellCommand(ctx(['choose', '2026-08-27']), 'done', c.out)
    expect(code).toBe(EXIT.USAGE)
    expect(c.stderr()).toMatch(/matches 2 items/)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('multi-mark items', () => {
  it('marking the final chunk done flips the reported state to finished', async () => {
    await init()
    const id = await addItem('write report')

    // First chunk: done on an early date.
    await runCellCommand(ctx([id, '2026-08-24']), 'done', capture().out)
    // Second chunk: due on a later date — item is not finished (latest mark is due).
    await runCellCommand(ctx([id, '2026-08-27']), 'due', capture().out)
    let item = onDisk().items.find((i) => i.id === id)!
    expect(displayState(item, TODAY)).toBe('open')

    // Mark the final chunk done: now the latest mark is done -> finished.
    const c = capture()
    const code = await runCellCommand(ctx([id, '2026-08-27']), 'done', c.out)
    expect(code).toBe(EXIT.OK)
    expect(c.stdout()).toMatch(/Now finished\.?/)

    item = onDisk().items.find((i) => i.id === id)!
    expect(displayState(item, TODAY)).toBe('finished')
  })
})
