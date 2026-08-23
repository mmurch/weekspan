/**
 * `ledger list` — see e2e.test.ts for the fixture style this copies:
 * `mkdtempSync` temp dir, `capture()` over `PassThrough` streams, `ctx()`
 * builder, `onDisk()` reader.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Ledger } from '@murch-todo/ledger-core'
import type { CommandContext } from '../command.js'
import { createOutput, type Output } from '../output.js'
import { runInit } from './init.js'
import { runList } from './list.js'
import { runAdd } from './items.js'
import { runCellCommand } from './cells.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let ledgerPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ledger-list-'))
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

function writeDisk(l: Ledger): void {
  writeFileSync(ledgerPath, JSON.stringify(l, null, 2), 'utf8')
}

async function init(): Promise<void> {
  await runInit(ctx([]), capture().out)
}

interface JsonRow {
  id: string
  title: string
  state: string
  indent: number
  projectId: string | null
  recurring: boolean
  marks: Array<{ date: string; kind: string }>
}

async function listJson(argv: string[]): Promise<{ items: JsonRow[]; window: { from: string; to: string } }> {
  const c = capture(true)
  await runList(ctx(argv, true), c.out)
  return JSON.parse(c.stdout()).data
}

describe('ordering', () => {
  it('follows orderItems sequence, with a child directly after its parent and indented', async () => {
    await init()
    await runAdd(ctx(['alpha root']), capture().out)
    const alpha = onDisk().items[0]!.id
    await runAdd(ctx(['charlie root']), capture().out)
    // Child of alpha, added AFTER charlie — orderItems must still place it
    // directly after alpha, ahead of charlie.
    await runAdd(ctx(['bravo child', '--parent', alpha]), capture().out)

    const { items } = await listJson([])
    const ids = items.map((r) => r.id)
    const alphaIdx = ids.indexOf(alpha)
    const bravo = onDisk().items.find((i) => i.title === 'bravo child')!.id
    const charlie = onDisk().items.find((i) => i.title === 'charlie root')!.id

    expect(ids).toEqual([alpha, bravo, charlie])
    expect(items[alphaIdx]!.indent).toBe(0)
    expect(items[alphaIdx + 1]!.indent).toBe(1)
    expect(items.find((r) => r.id === charlie)!.indent).toBe(0)
  })
})

describe('--project filter', () => {
  it('keeps only items whose projectId matches', async () => {
    await init()
    const l = onDisk()
    l.projects.push({ id: 'work', name: 'Work', colorToken: 'barA' })
    writeDisk(l)
    await runAdd(ctx(['tagged item', '--project', 'work']), capture().out)
    await runAdd(ctx(['untagged item']), capture().out)

    const { items } = await listJson(['--project', 'work'])
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('tagged item')
    expect(items[0]!.projectId).toBe('work')
  })
})

describe('--open / --done filter by derived state', () => {
  it('filters on displayState, not any stored field', async () => {
    await init()
    await runAdd(ctx(['open item']), capture().out)
    await runAdd(ctx(['finished item']), capture().out)
    const finishedId = onDisk().items.find((i) => i.title === 'finished item')!.id
    await runCellCommand(ctx([finishedId, TODAY]), 'done', capture().out)

    const open = await listJson(['--open'])
    expect(open.items.map((r) => r.title)).toEqual(['open item'])
    expect(open.items[0]!.state).toBe('open')

    const done = await listJson(['--done'])
    expect(done.items.map((r) => r.title)).toEqual(['finished item'])
    expect(done.items[0]!.state).toBe('finished')
  })
})

describe('--week narrows the inspected dates', () => {
  it('only shows marks for dates within the given week', async () => {
    await init()
    // weekly, weekday=1 (Monday), anchored today: first occurrence is
    // Monday 2026-08-31, which falls in week 2026-W36.
    await runAdd(ctx(['water plants', '--recur', 'weekly', '--weekday', '1']), capture().out)
    const id = onDisk().items[0]!.id

    const inWeek = await listJson(['--week', '2026-W36'])
    const rowIn = inWeek.items.find((r) => r.id === id)!
    expect(rowIn.marks).toEqual([{ date: '2026-08-31', kind: 'due' }])

    const outOfWeek = await listJson(['--week', '2026-W35'])
    const rowOut = outOfWeek.items.find((r) => r.id === id)!
    expect(rowOut.marks).toEqual([])
  })
})

describe('--due-before', () => {
  it('accepts all date forms and filters correctly', async () => {
    await init()
    await runAdd(ctx(['due tuesday', '--due', '2026-08-25']), capture().out)
    await runAdd(ctx(['no due date']), capture().out)

    for (const form of ['2026-08-27', 'tomorrow', 'thu']) {
      const { items } = await listJson(['--due-before', form])
      expect(items.map((r) => r.title)).toEqual(['due tuesday'])
    }
  })

  it('excludes items with no earlier due', async () => {
    await init()
    await runAdd(ctx(['due next week', '--due', '2026-09-05']), capture().out)
    const { items } = await listJson(['--due-before', '2026-08-27'])
    expect(items).toEqual([])
  })
})

describe('recurring items generate a due even with an empty marks map', () => {
  it('shows a GENERATED due though marks on disk is empty', async () => {
    await init()
    await runAdd(
      ctx(['daily standup', '--recur', 'weekly', '--weekday', '3']), // 3 = Wednesday = today
      capture().out,
    )
    const id = onDisk().items[0]!.id
    expect(onDisk().items[0]!.marks).toEqual({})

    const { items } = await listJson([])
    const row = items.find((r) => r.id === id)!
    expect(row.recurring).toBe(true)
    expect(row.marks).toContainEqual({ date: TODAY, kind: 'due' })

    // Still empty on disk — list never wrote anything.
    expect(onDisk().items[0]!.marks).toEqual({})
  })

  it('an explicit mark on the occurrence date overrides the generated one', async () => {
    await init()
    await runAdd(ctx(['daily standup', '--recur', 'weekly', '--weekday', '3']), capture().out)
    const id = onDisk().items[0]!.id
    await runCellCommand(ctx([id, TODAY]), 'done', capture().out)

    const { items } = await listJson([])
    const row = items.find((r) => r.id === id)!
    expect(row.marks).toContainEqual({ date: TODAY, kind: 'done' })
    expect(row.marks.some((m) => m.kind === 'due' && m.date === TODAY)).toBe(false)
  })
})

describe('empty results', () => {
  it('prints a clear message rather than blank output', async () => {
    await init()
    await runAdd(ctx(['something']), capture().out)

    const c = capture()
    await runList(ctx(['--project', 'does-not-exist']), c.out)
    expect(c.stdout().trim()).toBe('No matching items.')
  })
})

describe('--json output', () => {
  it('parses and item entries have stable keys', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)

    const { items } = await listJson([])
    expect(items).toHaveLength(1)
    expect(Object.keys(items[0]!).sort()).toEqual(
      ['id', 'indent', 'marks', 'projectId', 'recurring', 'state', 'title'].sort(),
    )
  })
})

describe('list never writes', () => {
  it('leaves the file byte-identical before and after any filter combination', async () => {
    await init()
    await runAdd(ctx(['a task', '--due', '2026-08-25']), capture().out)
    await runAdd(ctx(['recurring', '--recur', 'weekly', '--weekday', '3']), capture().out)
    const before = readFileSync(ledgerPath, 'utf8')

    await runList(ctx([]), capture().out)
    await runList(ctx(['--open']), capture().out)
    await runList(ctx(['--done']), capture().out)
    await runList(ctx(['--week', '2026-W35']), capture().out)
    await runList(ctx(['--due-before', 'tomorrow']), capture().out)
    await runList(ctx([], true), capture(true).out)

    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('--week covers the full seven days', () => {
  it('shows a weekend due, because close-out blocks on one', async () => {
    // Regression: --week used weekdayDates (Mon-Fri) while close-out scans
    // Mon-Sun. A Saturday due therefore blocked the week from closing while
    // being invisible in `list --week` — the user could see they were blocked
    // but had no way to find the mark responsible.
    await init()
    await runAdd(ctx(['weekend task']), capture().out)
    const id = onDisk().items[0]!.id
    await runCellCommand(ctx([id, '2026-08-22']), 'due', capture().out) // Saturday, W34

    const c = capture(true)
    await runList(ctx(['--week', '2026-W34'], true), c.out)
    const item = JSON.parse(c.stdout()).data.items[0]
    expect(item.marks.map((m: { date: string }) => m.date)).toContain('2026-08-22')
  })
})
