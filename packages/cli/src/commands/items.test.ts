/**
 * Unit tests for `ledger add | rm | edit | move` — item lifecycle.
 *
 * Fixture style copied from `../e2e.test.ts`: real temp files, real commands,
 * real serialized output. `items.ts` is the highest-risk untested module in
 * this package (creates, destroys, and reorders the user's data), so these
 * tests exercise real disk I/O rather than mocking `mutate`/`io`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { orderItems, type Ledger } from '@murch-todo/ledger-core'
import type { CommandContext } from '../command.js'
import { CliError, EXIT } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { runInit } from './init.js'
import { runAdd, runEdit, runMove, runRm } from './items.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let ledgerPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ledger-items-'))
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

/** Run `fn` and hand back the thrown value, or `undefined` if it didn't throw. */
async function catchError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err
  }
}

describe('add', () => {
  it('creates an item and prints its id', async () => {
    await init()
    const added = capture()
    await runAdd(ctx(['buy milk']), added.out)
    const id = onDisk().items[0]!.id
    expect(id).toBeTruthy()
    expect(added.stdout()).toContain(id)
  })

  it('generates unique ids across many adds', async () => {
    await init()
    for (let i = 0; i < 20; i++) {
      await runAdd(ctx([`task ${i}`]), capture().out)
    }
    const ids = onDisk().items.map((i) => i.id)
    expect(ids).toHaveLength(20)
    expect(new Set(ids).size).toBe(20)
  })

  it.each([
    ['thu', '2026-08-27'], // next Thursday on/after Wed 2026-08-26
    ['today', '2026-08-26'],
    ['+3d', '2026-08-29'],
    ['2026-09-01', '2026-09-01'],
  ])('accepts --due %s', async (input, expected) => {
    await init()
    await runAdd(ctx(['task', '--due', input]), capture().out)
    const item = onDisk().items[0]!
    expect(item.marks[expected]?.kind).toBe('due')
  })

  it('lands --project, --notes and --parent on the item', async () => {
    await init()
    await runAdd(ctx(['root task']), capture().out)
    const root = onDisk().items[0]!
    await runAdd(
      ctx(['child task', '--project', 'work', '--notes', 'some notes', '--parent', root.id]),
      capture().out,
    )
    const child = onDisk().items[1]!
    expect(child.projectId).toBe('work')
    expect(child.notes).toBe('some notes')
    expect(child.parentId).toBe(root.id)
  })

  it('--after places the new item immediately after the anchor', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    await runAdd(ctx(['b']), capture().out)
    const [a] = onDisk().items
    await runAdd(ctx(['c', '--after', a!.id]), capture().out)
    expect(orderItems(onDisk().items).map((i) => i.title)).toEqual(['a', 'c', 'b'])
  })

  it('--before places the new item immediately before the anchor', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    await runAdd(ctx(['b']), capture().out)
    const [, b] = onDisk().items
    await runAdd(ctx(['c', '--before', b!.id]), capture().out)
    expect(orderItems(onDisk().items).map((i) => i.title)).toEqual(['a', 'c', 'b'])
  })

  it('defaults to appending at the end when neither --after nor --before is given', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    await runAdd(ctx(['b']), capture().out)
    await runAdd(ctx(['c']), capture().out)
    expect(orderItems(onDisk().items).map((i) => i.title)).toEqual(['a', 'b', 'c'])
  })

  it('accepts a valid --recur weekly --weekday 1', async () => {
    await init()
    await runAdd(ctx(['water plants', '--recur', 'weekly', '--weekday', '1']), capture().out)
    const item = onDisk().items[0]!
    expect(item.recurrence).toEqual({ freq: 'weekly', anchor: TODAY, weekday: 1 })
  })

  it('rejects an invalid recurrence (weekly without --weekday) BEFORE writing', async () => {
    await init()
    const before = readFileSync(ledgerPath, 'utf8')
    const err = await catchError(() => runAdd(ctx(['water plants', '--recur', 'weekly']), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect((err as Error).message).toMatch(/weekday/)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('rejects an invalid recurrence (--weekday 9 is out of range) BEFORE writing', async () => {
    await init()
    const before = readFileSync(ledgerPath, 'utf8')
    const err = await catchError(() =>
      runAdd(ctx(['water plants', '--recur', 'weekly', '--weekday', '9']), capture().out),
    )
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('rejects an empty title', async () => {
    await init()
    const before = readFileSync(ledgerPath, 'utf8')
    const err = await catchError(() => runAdd(ctx(['   ']), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('nesting (one level only)', () => {
  it('--parent <root> creates a child', async () => {
    await init()
    await runAdd(ctx(['root']), capture().out)
    const root = onDisk().items[0]!
    await runAdd(ctx(['child', '--parent', root.id]), capture().out)
    expect(onDisk().items[1]!.parentId).toBe(root.id)
  })

  it('--parent <child> is rejected with EXIT.USAGE and writes nothing', async () => {
    await init()
    await runAdd(ctx(['root']), capture().out)
    const root = onDisk().items[0]!
    await runAdd(ctx(['child', '--parent', root.id]), capture().out)
    const child = onDisk().items[1]!
    const before = readFileSync(ledgerPath, 'utf8')

    const err = await catchError(() => runAdd(ctx(['grandchild', '--parent', child.id]), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('rm', () => {
  it('without --force (and not --json) refuses and writes nothing', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const id = onDisk().items[0]!.id
    const before = readFileSync(ledgerPath, 'utf8')

    const err = await catchError(() => runRm(ctx([id]), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('still refuses without --force under --json — AGENTS.md documents --force as always required', async () => {
    // `ledger rm <item> --force` is the documented contract (templates/AGENTS.md);
    // --json only changes how success/failure is reported, it must not change
    // what is allowed. Agents drive the CLI through --json, so a bypass here
    // would make the *primary* agent interface the unsafe one.
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const id = onDisk().items[0]!.id
    const before = readFileSync(ledgerPath, 'utf8')

    const err = await catchError(() => runRm(ctx([id], true), capture(true).out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('with --force it removes the item', async () => {
    await init()
    await runAdd(ctx(['a task']), capture().out)
    const id = onDisk().items[0]!.id
    await runRm(ctx([id, '--force']), capture().out)
    expect(onDisk().items).toHaveLength(0)
  })

  it('a parent with children refuses without --recursive, naming the child count, and the file still parses', async () => {
    await init()
    await runAdd(ctx(['root']), capture().out)
    const root = onDisk().items[0]!
    await runAdd(ctx(['child1', '--parent', root.id]), capture().out)
    await runAdd(ctx(['child2', '--parent', root.id]), capture().out)

    const err = await catchError(() => runRm(ctx([root.id, '--force']), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.CONFLICT)
    expect((err as Error).message).toMatch(/2 sub-item/)

    // Orphaning the children into a dangling parentId would make the file fail
    // to parse on the next load — verify it still parses and nothing was removed.
    expect(() => onDisk()).not.toThrow()
    expect(onDisk().items).toHaveLength(3)
  })

  it('--recursive removes the parent and its children together', async () => {
    await init()
    await runAdd(ctx(['root']), capture().out)
    const root = onDisk().items[0]!
    await runAdd(ctx(['child1', '--parent', root.id]), capture().out)
    await runAdd(ctx(['child2', '--parent', root.id]), capture().out)

    await runRm(ctx([root.id, '--force', '--recursive']), capture().out)
    expect(onDisk().items).toHaveLength(0)
  })
})

describe('edit', () => {
  it('--title, --notes and --project update in place and leave other fields untouched', async () => {
    await init()
    await runAdd(ctx(['task', '--due', 'today']), capture().out)
    const original = onDisk().items[0]!

    await runEdit(
      ctx([original.id, '--title', 'new title', '--notes', 'new notes', '--project', 'work']),
      capture().out,
    )

    const edited = onDisk().items[0]!
    expect(edited.title).toBe('new title')
    expect(edited.notes).toBe('new notes')
    expect(edited.projectId).toBe('work')
    expect(edited.id).toBe(original.id)
    expect(edited.rank).toBe(original.rank)
    expect(edited.marks).toEqual(original.marks)
  })

  it('--no-recur clears a recurrence', async () => {
    await init()
    await runAdd(ctx(['water plants', '--recur', 'weekly', '--weekday', '1']), capture().out)
    const id = onDisk().items[0]!.id
    expect(onDisk().items[0]!.recurrence).toBeTruthy()

    await runEdit(ctx([id, '--no-recur']), capture().out)
    expect(onDisk().items[0]!.recurrence).toBeNull()
  })
})

describe('move', () => {
  it('moves an item that must move, producing a rank that sorts correctly', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    await runAdd(ctx(['b']), capture().out)
    await runAdd(ctx(['c']), capture().out)
    const [a, , c] = onDisk().items

    await runMove(ctx([a!.id, '--after', c!.id]), capture().out)
    expect(orderItems(onDisk().items).map((i) => i.title)).toEqual(['b', 'c', 'a'])
  })

  it('a move that is already satisfied writes nothing', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    await runAdd(ctx(['b']), capture().out)
    const [a, b] = onDisk().items
    const before = readFileSync(ledgerPath, 'utf8')

    const c = capture()
    await runMove(ctx([b!.id, '--after', a!.id]), c.out)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
    expect(c.stdout()).toMatch(/already in position/)
  })

  it('rejects moving an item relative to itself', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    const id = onDisk().items[0]!.id
    const before = readFileSync(ledgerPath, 'utf8')

    const err = await catchError(() => runMove(ctx([id, '--after', id]), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('rejects a move with neither --before nor --after', async () => {
    await init()
    await runAdd(ctx(['a']), capture().out)
    const id = onDisk().items[0]!.id
    const before = readFileSync(ledgerPath, 'utf8')

    const err = await catchError(() => runMove(ctx([id]), capture().out))
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe(EXIT.USAGE)
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('--after/--before must name a sibling', () => {
  it('rejects an anchor from a different rank scope instead of guessing a position', async () => {
    // Ranks are sibling-scoped. Before this guard, findIndex returned -1 and
    // `scope[idx + 1]` silently resolved to `scope[0]`, dropping the new item at
    // an arbitrary position — or throwing an opaque RankError from inside
    // rankForInsert, depending on how the anchor's rank happened to compare.
    await init()
    await runAdd(ctx(['root one']), capture().out)
    const rootId = onDisk().items[0]!.id
    await runAdd(ctx(['a child', '--parent', rootId]), capture().out)
    await runAdd(ctx(['root two']), capture().out)
    const childId = onDisk().items.find((i) => i.parentId === rootId)!.id

    const before = readFileSync(ledgerPath, 'utf8')
    // `childId` is a child of root one; the new item is a root. Different scopes.
    await expect(runAdd(ctx(['new root', '--after', childId]), capture().out)).rejects.toThrow(
      /not a sibling/,
    )
    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })

  it('still accepts an anchor within the same parent scope', async () => {
    await init()
    await runAdd(ctx(['root']), capture().out)
    const rootId = onDisk().items[0]!.id
    await runAdd(ctx(['child a', '--parent', rootId]), capture().out)
    const childA = onDisk().items.find((i) => i.parentId === rootId)!.id

    await runAdd(ctx(['child b', '--parent', rootId, '--after', childA]), capture().out)
    const children = onDisk().items.filter((i) => i.parentId === rootId)
    expect(children).toHaveLength(2)
  })
})
