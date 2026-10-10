import type { ArchiveFile, IsoWeek, Weekspan } from '@weekspan/weekspan-core'

/**
 * The seam between the app and wherever the weekspan actually lives.
 *
 * Everything above this interface — every mutation, every view — is testable
 * headlessly against `MemoryStore`. Only the File System Access implementation
 * needs a real browser and a user gesture, which is exactly the part that cannot
 * be tested in CI.
 */
export interface FileStore {
  /** Human-readable name for the file picker, e.g. `personal.weekspan.json`. */
  readonly name: string

  /** Current contents, or null when nothing is bound yet. */
  read(): Promise<string | null>

  /**
   * Write, given the text we last read so the implementation can detect a
   * concurrent change. Returns what is now on disk, which may differ from what
   * was passed if a merge occurred.
   */
  write(next: string, baseline: string | null): Promise<WriteResult>

  /** Poll for an external change. Cheap: should avoid a full read when possible. */
  hasChanged(baseline: string | null): Promise<boolean>

  /**
   * Persist one closed-out week's archive (`archive/<week>.json` for a real
   * directory; kept in memory for `MemoryStore`). MUST refuse to overwrite an
   * existing archive for the same week — a closed week is history, and
   * silently replacing it destroys records; implementations throw instead.
   * Returns a caller-displayable location for what was written.
   */
  writeArchive(archive: ArchiveFile): Promise<string>
}

export interface WriteResult {
  /** The text now on disk. */
  text: string
  /** True when another writer's changes had to be merged in. */
  merged: boolean
  /** Fields where both sides changed; resolved toward ours. */
  conflicts: Array<{ itemId: string | null; field: string }>
  /**
   * Items the merge had to give a fresh rank because both writers minted the
   * same one. Not a conflict — nothing is lost — but a row moved, so the UI
   * says so rather than letting the file change under the user in silence.
   */
  ranksRepaired: number
}

/**
 * In-memory store: tests, the demo fixtures, and any state before a real file is
 * bound. Deliberately implements the same contract, so a bug in the mutation
 * layer surfaces here rather than only against a real file.
 */
export class MemoryStore implements FileStore {
  readonly name: string
  private text: string | null
  /** `writeArchive`'s in-memory equivalent of `archive/<week>.json`. */
  private readonly archives = new Map<IsoWeek, ArchiveFile>()

  constructor(initial: string | null = null, name = 'memory.weekspan.json') {
    this.text = initial
    this.name = name
  }

  async read(): Promise<string | null> {
    return this.text
  }

  /**
   * Takes `baseline` to match the interface even though it ignores it: a memory
   * store has no other writer to race with. Declaring the full signature keeps
   * callers honest — a caller that forgets to pass a baseline should fail the
   * same way here as it would against a real file.
   */
  async write(next: string, _baseline: string | null = null): Promise<WriteResult> {
    this.text = next
    return { text: next, merged: false, conflicts: [], ranksRepaired: 0 }
  }

  async hasChanged(baseline: string | null): Promise<boolean> {
    return this.text !== baseline
  }

  /** Test hook: simulate another writer (a CLI run, another tab) touching the file. */
  externalWrite(text: string): void {
    this.text = text
  }

  /**
   * Mirrors `FileSystemStore.writeArchive`'s no-overwrite guarantee, so
   * close-out logic exercised against `MemoryStore` in tests fails the exact
   * same way it would against a real directory.
   */
  async writeArchive(archive: ArchiveFile): Promise<string> {
    if (this.archives.has(archive.week)) {
      throw new Error(`Archive for ${archive.week} already exists — refusing to overwrite a closed week.`)
    }
    this.archives.set(archive.week, archive)
    return `archive/${archive.week}.json`
  }

  /** Test hook: inspect what `performClose`/`performAutoClose` actually archived. */
  getArchive(week: IsoWeek): ArchiveFile | null {
    return this.archives.get(week) ?? null
  }
}

export type StoreStatus =
  | { kind: 'unbound' }
  | { kind: 'loading' }
  | { kind: 'ready'; weekspan: Weekspan }
  | { kind: 'error'; message: string; recoverable: boolean }
