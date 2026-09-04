import { createWeekspan, parse, serialize, type ArchiveFile, type Item, type Weekspan } from '@weekspan/weekspan-core'
import { FileSystemStore } from './FileSystemStore.js'

/**
 * Fakes for `FileSystemDirectoryHandle` / `FileSystemFileHandle` /
 * `FileSystemWritableFileStream`.
 *
 * Deliberately not real browser APIs — that is exactly the part the task
 * calls out as untestable in CI (see FileSystemStore.ts's doc comment and
 * scripts/probe-handle-persistence.mjs for the one thing that DOES need a
 * real browser). Everything about staleness detection, merge behaviour, and
 * directory operations (`getFileHandle`, `getDirectoryHandle`, `values`) is
 * plain TypeScript logic, so a duck-typed fake exercises the exact same code
 * paths.
 */

class FakeFile {
  constructor(
    private readonly content: string,
    readonly lastModified: number,
    private readonly onRead: () => void,
  ) {}

  async text(): Promise<string> {
    this.onRead()
    return this.content
  }
}

class FakeWritable {
  private pending: string | null = null
  constructor(private readonly handle: FakeFileHandle) {}

  async write(data: string): Promise<void> {
    this.pending = data
  }

  async close(): Promise<void> {
    if (this.pending !== null) this.handle.applyWrite(this.pending)
  }
}

class FakeFileHandle {
  readonly kind = 'file' as const
  readonly name: string
  content: string
  mtime: number
  /** How many times `.text()` was actually called — proves a read was (or wasn't) skipped. */
  textReads = 0
  /** How many times a write was actually committed via `createWritable()...close()`. */
  writeCount = 0

  constructor(name: string, content: string, mtime: number) {
    this.name = name
    this.content = content
    this.mtime = mtime
  }

  async getFile(): Promise<FakeFile> {
    return new FakeFile(this.content, this.mtime, () => {
      this.textReads++
    })
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this)
  }

  /** Applies a write the way the real browser would once the stream closes. */
  applyWrite(text: string): void {
    this.content = text
    this.mtime += 1
    this.writeCount++
  }

  /** Test hook: simulate another writer (another tab, the CLI, an agent) touching the file directly. */
  externalWrite(text: string, mtime: number): void {
    this.content = text
    this.mtime = mtime
  }
}

function notFoundError(name: string): DOMException {
  return new DOMException(`${name} not found`, 'NotFoundError')
}

/** A fake `FileSystemDirectoryHandle`: an in-memory map of file/subdirectory names. */
class FakeDirHandle {
  readonly kind = 'directory' as const
  readonly name: string
  readonly files = new Map<string, FakeFileHandle>()
  readonly dirs = new Map<string, FakeDirHandle>()

  constructor(name: string) {
    this.name = name
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    let handle = this.files.get(name)
    if (!handle) {
      if (!options?.create) throw notFoundError(name)
      handle = new FakeFileHandle(name, '', Date.now())
      this.files.set(name, handle)
    }
    return handle
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirHandle> {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!options?.create) throw notFoundError(name)
      dir = new FakeDirHandle(name)
      this.dirs.set(name, dir)
    }
    return dir
  }

  async *values(): AsyncGenerator<FakeFileHandle | FakeDirHandle> {
    for (const f of this.files.values()) yield f
    for (const d of this.dirs.values()) yield d
  }

  /** Test hook: seed an existing file directly, bypassing `getFileHandle`. */
  seedFile(name: string, content: string, mtime: number): FakeFileHandle {
    const handle = new FakeFileHandle(name, content, mtime)
    this.files.set(name, handle)
    return handle
  }
}

function asDirHandle(fake: FakeDirHandle): FileSystemDirectoryHandle {
  return fake as unknown as FileSystemDirectoryHandle
}

function item(id: string, rank: string): Item {
  return { id, title: `Item ${id}`, rank, marks: {} }
}

function weekspan(items: Item[] = []): Weekspan {
  return createWeekspan({ items })
}

/** Convenience: a directory containing exactly one seeded weekspan file, plus the store bound to it. */
function makeStore(
  content: string,
  mtime = 1000,
  fileName = 'w.json',
): { store: FileSystemStore; dir: FakeDirHandle; file: FakeFileHandle } {
  const dir = new FakeDirHandle('root')
  const file = dir.seedFile(fileName, content, mtime)
  const store = new FileSystemStore(asDirHandle(dir), fileName)
  return { store, dir, file }
}

describe('FileSystemStore — read', () => {
  it('returns the file contents', async () => {
    const text = serialize(weekspan([item('a', 'aV')]))
    const { store } = makeStore(text)
    expect(await store.read()).toBe(text)
  })

  it('returns null for an empty file', async () => {
    const { store } = makeStore('')
    expect(await store.read()).toBeNull()
  })
})

describe('FileSystemStore — write, unchanged underneath', () => {
  it('writes directly and reports no merge when the file has not moved since baseline', async () => {
    const baselineText = serialize(weekspan([item('a', 'aV')]))
    const nextText = serialize(weekspan([item('a', 'aV'), item('b', 'aW')]))
    const { store, file } = makeStore(baselineText)

    const result = await store.write(nextText, baselineText)

    expect(result).toEqual({ text: nextText, merged: false, conflicts: [], ranksRepaired: 0 })
    expect(file.content).toBe(nextText) // actually landed on "disk"
    expect(file.writeCount).toBe(1)
  })

  it('skips the physical write when the result is byte-identical to what is already there', async () => {
    const text = serialize(weekspan([item('a', 'aV')]))
    const { store, file } = makeStore(text)

    await store.write(text, text)

    expect(file.writeCount).toBe(0)
  })
})

describe('FileSystemStore — write, file changed underneath', () => {
  it('merges instead of clobbering when someone else wrote first', async () => {
    const base = weekspan([item('a', 'aV')])
    const baselineText = serialize(base)

    // We add "b" in memory...
    const ours = weekspan([item('a', 'aV'), item('b', 'aW')])
    // ...while someone else (another tab, the CLI) already wrote "c" to disk.
    const theirs = weekspan([item('a', 'aV'), item('c', 'aX')])
    const { store, file } = makeStore(serialize(theirs), 2000)

    const result = await store.write(serialize(ours), baselineText)

    expect(result.merged).toBe(true)
    expect(result.conflicts).toEqual([]) // additive change on each side: no real conflict
    const mergedIds = parse(result.text)
      .items.map((i) => i.id)
      .sort()
    expect(mergedIds).toEqual(['a', 'b', 'c']) // NEITHER side's addition was dropped
    expect(file.content).toBe(result.text) // the merge result, not "ours", landed on disk
  })

  it('reports real conflicts (both sides edited the same field) resolved toward ours', async () => {
    const base = weekspan([item('a', 'aV')])
    const baselineText = serialize(base)

    const ours = weekspan([{ ...item('a', 'aV'), title: 'Ours title' }])
    const theirs = weekspan([{ ...item('a', 'aV'), title: 'Theirs title' }])
    const { store, file } = makeStore(serialize(theirs), 2000)

    const result = await store.write(serialize(ours), baselineText)

    expect(result.merged).toBe(true)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ itemId: 'a', field: 'title' })
    expect(parse(result.text).items[0]?.title).toBe('Ours title') // conflicts resolve toward ours
  })

  it('a same-second concurrent write is still detected via content, never via mtime', async () => {
    // packages/cli/src/io.ts hit this exactly: filesystem mtime granularity is
    // often one second, so a concurrent write landing in the same second as
    // ours reports an UNCHANGED lastModified. write() must not use mtime at
    // all for staleness — it always re-reads and compares content — so this
    // must still merge rather than clobber even though `file.mtime` here
    // never moves.
    const base = weekspan([item('a', 'aV')])
    const baselineText = serialize(base)
    const { store, file } = makeStore(baselineText)
    await store.read() // primes internal state at mtime 1000

    const theirs = weekspan([item('a', 'aV'), item('c', 'aX')])
    file.externalWrite(serialize(theirs), 1000) // SAME mtime as above, different content

    const ours = weekspan([item('a', 'aV'), item('b', 'aW')])
    const result = await store.write(serialize(ours), baselineText)

    expect(result.merged).toBe(true)
    const mergedIds = parse(result.text)
      .items.map((i) => i.id)
      .sort()
    expect(mergedIds).toEqual(['a', 'b', 'c'])
    expect(file.content).toBe(result.text)
  })
})

describe('FileSystemStore — hasChanged', () => {
  it('returns false, without reading content, when mtime has not moved', async () => {
    const text = serialize(weekspan([item('a', 'aV')]))
    const { store, file } = makeStore(text)
    await store.read() // primes lastKnownModified = 1000
    file.textReads = 0 // ignore reads from the priming read()

    expect(await store.hasChanged(text)).toBe(false)
    expect(file.textReads).toBe(0) // the whole point: no read needed
  })

  it('returns false when mtime moved but content is identical (e.g. a touch, or a same-content resave)', async () => {
    const text = serialize(weekspan([item('a', 'aV')]))
    const { store, file } = makeStore(text)
    await store.read()

    file.externalWrite(text, 2000) // mtime moved, bytes did not

    expect(await store.hasChanged(text)).toBe(false)
    expect(file.textReads).toBeGreaterThan(0) // it DID check — mtime alone isn't trusted for "changed"
  })

  it('returns true when mtime moved and content actually differs', async () => {
    const text = serialize(weekspan([item('a', 'aV')]))
    const { store, file } = makeStore(text)
    await store.read()

    const changed = serialize(weekspan([item('a', 'aV'), item('b', 'aW')]))
    file.externalWrite(changed, 2000)

    expect(await store.hasChanged(text)).toBe(true)
  })
})

describe('FileSystemStore — writeArchive', () => {
  it('creates archive/ and writes the file', async () => {
    const { store, dir } = makeStore('')
    const archive: ArchiveFile = { version: 1, week: '2026-W34', items: [item('a', 'aV')] }

    const path = await store.writeArchive(archive)

    expect(path).toBe('archive/2026-W34.json')
    const archiveDir = dir.dirs.get('archive')
    expect(archiveDir).toBeDefined()
    const file = archiveDir?.files.get('2026-W34.json')
    expect(file).toBeDefined()
    expect(file?.content).toContain('2026-W34')
    expect(file?.content).toContain('"a"')
  })

  it('REFUSES to overwrite an existing archive for the same week', async () => {
    const { store } = makeStore('')
    const archive: ArchiveFile = { version: 1, week: '2026-W34', items: [] }

    await store.writeArchive(archive)

    await expect(store.writeArchive(archive)).rejects.toThrow(/already exists/)
  })

  it('archiving different weeks does not collide', async () => {
    const { store, dir } = makeStore('')

    await store.writeArchive({ version: 1, week: '2026-W33', items: [] })
    await store.writeArchive({ version: 1, week: '2026-W34', items: [] })

    const archiveDir = dir.dirs.get('archive')
    expect(archiveDir?.files.size).toBe(2)
  })
})

describe('FileSystemStore — listWeekspanFiles', () => {
  it('returns only *.weekspan.json files, sorted, ignoring everything else', async () => {
    const { store, dir } = makeStore('', 1000, 'personal.weekspan.json')
    dir.seedFile('work.weekspan.json', '', 1000)
    dir.seedFile('weekspan.schema.json', '', 1000)
    dir.seedFile('AGENTS.md', '', 1000)
    dir.dirs.set('archive', new FakeDirHandle('archive')) // a directory, not a file — must not appear

    expect(await store.listWeekspanFiles()).toEqual(['personal.weekspan.json', 'work.weekspan.json'])
  })
})

describe('FileSystemStore — ensureSchemaFile', () => {
  it('writes once and never overwrites', async () => {
    const { store, dir } = makeStore('')

    expect(await store.ensureSchemaFile('{"first":true}')).toBe(true)
    expect(dir.files.get('weekspan.schema.json')?.content).toBe('{"first":true}')

    expect(await store.ensureSchemaFile('{"second":true}')).toBe(false)
    expect(dir.files.get('weekspan.schema.json')?.content).toBe('{"first":true}') // untouched
  })
})
