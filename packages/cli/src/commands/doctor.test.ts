/**
 * Unit tests for `weekspan doctor` / `doctor --fix`.
 *
 * Fixture style copied from ./closeout.test.ts: real temp files, `capture()`
 * wraps `createOutput` over in-memory `PassThrough` streams, `ctx()` builds a
 * `CommandContext`, `onDisk()` reads the weekspan back from disk.
 *
 * The damage under test is a duplicate rank, which has to be written to disk
 * directly — no command can produce one any more, which is the point.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Weekspan } from '@weekspan/weekspan-core'
import type { CommandContext } from '../command.js'
import { createOutput, type Output } from '../output.js'
import { EXIT } from '../exit.js'
import { runInit } from './init.js'
import { runAdd } from './items.js'
import { runDoctor } from './doctor.js'

const TODAY = '2026-08-26'

let dir: string
let weekspanPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'weekspan-doctor-'))
  weekspanPath = path.join(dir, 'l.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

interface Captured {
  out: Output
  stdout: () => string
}

function capture(json = false): Captured {
  const o = new PassThrough()
  const e = new PassThrough()
  let outBuf = ''
  o.on('data', (c) => (outBuf += c.toString()))
  return {
    out: createOutput({ json, color: false, stdout: o, stderr: e }),
    stdout: () => outBuf,
  }
}

function ctx(argv: string[], json = false): CommandContext {
  return { weekspanPath, json, today: TODAY, argv }
}

function onDisk(): Weekspan {
  return JSON.parse(readFileSync(weekspanPath, 'utf8')) as Weekspan
}

async function seed(titles: string[]): Promise<void> {
  await runInit(ctx([]), capture().out)
  for (const t of titles) await runAdd(ctx([t]), capture().out)
}

/** Give `victimTitle` the same rank as `donorTitle` — the damage doctor repairs. */
function collide(victimTitle: string, donorTitle: string): void {
  const w = onDisk()
  const donor = w.items.find((i) => i.title === donorTitle)!
  const victim = w.items.find((i) => i.title === victimTitle)!
  victim.rank = donor.rank
  writeFileSync(weekspanPath, JSON.stringify(w, null, 2), 'utf8')
}

describe('doctor', () => {
  it('reports a healthy file and exits OK', async () => {
    await seed(['a', 'b', 'c'])
    const cap = capture()
    expect(await runDoctor(ctx([]), cap.out)).toBe(EXIT.OK)
    expect(cap.stdout()).toContain('No problems found.')
  })

  it('finds a duplicate rank and exits CONFLICT without writing', async () => {
    await seed(['a', 'b', 'c'])
    collide('c', 'b')
    const textBefore = readFileSync(weekspanPath, 'utf8')

    const cap = capture()
    expect(await runDoctor(ctx([]), cap.out)).toBe(EXIT.CONFLICT)
    expect(cap.stdout()).toContain('share a rank')
    expect(cap.stdout()).toContain('doctor --fix')
    // A diagnosis must not touch the file.
    expect(readFileSync(weekspanPath, 'utf8')).toBe(textBefore)
  })

  it('--fix repairs the file and leaves it healthy', async () => {
    await seed(['a', 'b', 'c'])
    collide('c', 'b')

    expect(await runDoctor(ctx(['--fix']), capture().out)).toBe(EXIT.OK)

    const ranks = onDisk().items.map((i) => i.rank)
    expect(new Set(ranks).size).toBe(ranks.length)
    // A second run has nothing left to do.
    const cap = capture()
    expect(await runDoctor(ctx([]), cap.out)).toBe(EXIT.OK)
    expect(cap.stdout()).toContain('No problems found.')
  })

  it('--fix keeps every item, and keeps them in the same order', async () => {
    await seed(['a', 'b', 'c', 'd'])
    const orderBefore = [...onDisk().items].sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((i) => i.title)
    collide('c', 'b')

    await runDoctor(ctx(['--fix']), capture().out)

    const after = [...onDisk().items].sort((x, y) => (x.rank < y.rank ? -1 : 1))
    expect(after.map((i) => i.title)).toEqual(orderBefore)
  })

  it('emits structured output under --json', async () => {
    await seed(['a', 'b'])
    collide('b', 'a')
    const cap = capture(true)
    await runDoctor(ctx([], true), cap.out)
    const payload = JSON.parse(cap.stdout()) as {
      data: { healthy: boolean; duplicateRanks: { id: string; from: string; to: string }[] }
    }
    expect(payload.data.healthy).toBe(false)
    expect(payload.data.duplicateRanks).toHaveLength(1)
  })
})
