import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createWeekspan,
  serialize,
  setDone,
  setDue,
  type Item,
  type Weekspan,
} from '@weekspan/weekspan-core'
import { CliError, EXIT } from './exit.js'
import {
  atomicWrite,
  createWeekspanFile,
  ensureSchemaFile,
  loadWeekspan,
  saveWeekspan,
  writeArchive,
} from './io.js'

let dir: string
let weekspanPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'weekspan-io-'))
  weekspanPath = path.join(dir, 'personal.weekspan.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function item(id: string, rank: string, over: Partial<Item> = {}): Item {
  return { id, title: id, rank, marks: {}, ...over }
}

function seed(items: Item[] = []): Weekspan {
  return createWeekspan({ items })
}

function writeRaw(l: Weekspan): void {
  writeFileSync(weekspanPath, serialize(l), 'utf8')
}

describe('loadWeekspan', () => {
  it('explains a missing weekspan and points at init', async () => {
    await expect(loadWeekspan(weekspanPath)).rejects.toMatchObject({ code: EXIT.FILE })
    await expect(loadWeekspan(weekspanPath)).rejects.toThrow(/weekspan init/)
  })

  it('reports a malformed weekspan with the offending path', async () => {
    writeFileSync(weekspanPath, '{ "version": 1, "items": "nope" }', 'utf8')
    await expect(loadWeekspan(weekspanPath)).rejects.toThrow(/not a valid weekspan/)
  })

  it('refuses a file from a newer version without suggesting any write', async () => {
    const raw = JSON.parse(serialize(seed()))
    raw.version = 99
    writeFileSync(weekspanPath, JSON.stringify(raw), 'utf8')
    const err = await loadWeekspan(weekspanPath).catch((e: CliError) => e)
    expect((err as CliError).code).toBe(EXIT.FILE)
    expect((err as CliError).message).toMatch(/Update the CLI/)
    // Must not tell the user to edit or re-init — that would replicate data loss.
    expect((err as CliError).message).not.toMatch(/weekspan init/)
  })

  it('gives baseline and working copies that are independent objects', async () => {
    writeRaw(seed([item('a', 'aV')]))
    const loaded = await loadWeekspan(weekspanPath)
    loaded.weekspan.items[0]!.title = 'mutated'
    expect(loaded.baseline.items[0]!.title).toBe('a')
  })
})

describe('saveWeekspan', () => {
  it('writes nothing when the state is unchanged', async () => {
    writeRaw(seed([item('a', 'aV')]))
    const loaded = await loadWeekspan(weekspanPath)
    const before = readFileSync(weekspanPath, 'utf8')

    const result = await saveWeekspan(loaded, loaded.weekspan)
    expect(result.written).toBe(false)
    expect(readFileSync(weekspanPath, 'utf8')).toBe(before)
  })

  it('writes a changed weekspan', async () => {
    writeRaw(seed([item('a', 'aV')]))
    const loaded = await loadWeekspan(weekspanPath)
    const next: Weekspan = {
      ...loaded.weekspan,
      items: [setDone(loaded.weekspan.items[0]!, '2026-08-26')],
    }
    const result = await saveWeekspan(loaded, next)
    expect(result.written).toBe(true)
    expect(readFileSync(weekspanPath, 'utf8')).toContain('2026-08-26')
  })

  it('merges a concurrent write instead of clobbering it', async () => {
    // The scenario this whole layer exists for: a browser tab writes between our
    // read and our write. Neither edit may be lost.
    writeRaw(seed([item('a', 'aV'), item('b', 'am')]))
    const loaded = await loadWeekspan(weekspanPath)

    // Someone else marks item b done, directly on disk.
    const theirs: Weekspan = {
      ...loaded.baseline,
      items: [loaded.baseline.items[0]!, setDone(loaded.baseline.items[1]!, '2026-08-25')],
    }
    writeFileSync(weekspanPath, serialize(theirs), 'utf8')

    // We meanwhile set a due on item a.
    const ours: Weekspan = {
      ...loaded.weekspan,
      items: [setDue(loaded.weekspan.items[0]!, '2026-08-27'), loaded.weekspan.items[1]!],
    }
    const result = await saveWeekspan(loaded, ours)

    expect(result.merged).toBe(true)
    expect(result.written).toBe(true)
    expect(result.conflicts).toHaveLength(0)

    const final = JSON.parse(readFileSync(weekspanPath, 'utf8')) as Weekspan
    const a = final.items.find((i) => i.id === 'a')!
    const b = final.items.find((i) => i.id === 'b')!
    expect(a.marks['2026-08-27']!.kind).toBe('due')
    expect(b.marks['2026-08-25']!.kind).toBe('done')
  })

  it('surfaces conflicts when both sides changed the same cell', async () => {
    writeRaw(seed([item('a', 'aV', { marks: { '2026-08-26': { kind: 'due' } } })]))
    const loaded = await loadWeekspan(weekspanPath)

    const theirs: Weekspan = {
      ...loaded.baseline,
      items: [
        {
          ...loaded.baseline.items[0]!,
          marks: { '2026-08-26': { kind: 'skip', provenance: 'deliberate' } },
        },
      ],
    }
    writeFileSync(weekspanPath, serialize(theirs), 'utf8')

    const ours: Weekspan = {
      ...loaded.weekspan,
      items: [setDone(loaded.weekspan.items[0]!, '2026-08-26')],
    }
    const result = await saveWeekspan(loaded, ours)

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]!.field).toBe('marks.2026-08-26')
  })

  it('detects a concurrent write even within the same filesystem timestamp tick', async () => {
    // Content comparison rather than mtime: many filesystems report mtime at
    // 1s granularity, so two writes in the same second look identical by stat.
    writeRaw(seed([item('a', 'aV')]))
    const loaded = await loadWeekspan(weekspanPath)
    const theirs: Weekspan = {
      ...loaded.baseline,
      items: [setDone(loaded.baseline.items[0]!, '2026-08-25')],
    }
    writeFileSync(weekspanPath, serialize(theirs), 'utf8') // immediately, same tick
    const result = await saveWeekspan(loaded, { ...loaded.weekspan, vacationDays: ['2026-09-01'] })
    expect(result.merged).toBe(true)
  })

  it('keeps our edit when the file was deleted under us', async () => {
    writeRaw(seed([item('a', 'aV')]))
    const loaded = await loadWeekspan(weekspanPath)
    rmSync(weekspanPath)
    const result = await saveWeekspan(loaded, { ...loaded.weekspan, vacationDays: ['2026-09-01'] })
    expect(result.written).toBe(true)
    expect(readFileSync(weekspanPath, 'utf8')).toContain('2026-09-01')
  })
})

describe('atomicWrite', () => {
  it('leaves no temp files behind', async () => {
    await atomicWrite(weekspanPath, 'hello')
    expect(readdirSync(dir)).toEqual(['personal.weekspan.json'])
  })

  it('places the temp file in the target directory, not the system temp dir', async () => {
    // Rename is only atomic within a filesystem; a temp file elsewhere could
    // degrade to a copy, which is exactly the non-atomic write we are avoiding.
    const nested = path.join(dir, 'sub')
    const target = path.join(nested, 'l.json')
    await createWeekspanFile(target, seed())
    expect(readdirSync(nested)).toEqual(['l.json'])
  })

  it('overwrites an existing file completely, not partially', async () => {
    await atomicWrite(weekspanPath, 'a much longer original content string')
    await atomicWrite(weekspanPath, 'short')
    expect(readFileSync(weekspanPath, 'utf8')).toBe('short')
  })
})

describe('createWeekspanFile', () => {
  it('creates parent directories', async () => {
    const target = path.join(dir, 'a', 'b', 'l.json')
    await createWeekspanFile(target, seed())
    expect(readFileSync(target, 'utf8')).toContain('"version"')
  })

  it('refuses to overwrite an existing weekspan', async () => {
    await createWeekspanFile(weekspanPath, seed())
    await expect(createWeekspanFile(weekspanPath, seed())).rejects.toMatchObject({
      code: EXIT.CONFLICT,
    })
  })
})

describe('writeArchive', () => {
  it('writes into an archive/ directory beside the weekspan', async () => {
    const target = await writeArchive(weekspanPath, { version: 1, week: '2026-W34', items: [] })
    expect(target).toBe(path.join(dir, 'archive', '2026-W34.json'))
    expect(JSON.parse(readFileSync(target, 'utf8')).week).toBe('2026-W34')
  })

  it('refuses to overwrite an already-closed week', async () => {
    await writeArchive(weekspanPath, { version: 1, week: '2026-W34', items: [] })
    await expect(
      writeArchive(weekspanPath, { version: 1, week: '2026-W34', items: [] }),
    ).rejects.toMatchObject({ code: EXIT.CONFLICT })
  })
})

describe('ensureSchemaFile', () => {
  it('writes the schema once and never overwrites it', async () => {
    expect(await ensureSchemaFile(weekspanPath, '{"a":1}')).toBe(true)
    expect(await ensureSchemaFile(weekspanPath, '{"b":2}')).toBe(false)
    expect(readFileSync(path.join(dir, 'weekspan.schema.json'), 'utf8')).toBe('{"a":1}')
  })
})
