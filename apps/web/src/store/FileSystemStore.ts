/// <reference types="wicg-file-system-access" />

import { createWeekspan, merge, parse, serialize, serializeArchive } from '@weekspan/weekspan-core'
import type { ArchiveFile } from '@weekspan/weekspan-core'
import type { FileStore, WriteResult } from './FileStore.js'

/**
 * `FileStore` backed by a real `FileSystemDirectoryHandle` + a file name
 * inside it.
 *
 * Binding is a DIRECTORY, not a single file — see ARCHITECTURE.md
 * ("Deployment" → "Known gaps"). `showOpenFilePicker` yields a
 * `FileSystemFileHandle`, and a file handle cannot reach its parent (there is
 * no `getParent()`), so writing a SIBLING file is structurally impossible.
 * Three things need sibling access: `archive/<week>.json` on close-out, the
 * ledger dropdown listing several `*.weekspan.json` files, and
 * `weekspan.schema.json` beside the working file (as `weekspan init` does for
 * the CLI). A directory handle can reach all three via `getFileHandle` /
 * `getDirectoryHandle` on itself.
 *
 * Mirrors `packages/cli/src/io.ts`, which solved the read/write half of the
 * same problem for the CLI:
 *
 *   - `write()` NEVER trusts `file.lastModified` to decide whether it is safe to
 *     write. It always re-reads the file and compares CONTENT against `baseline`.
 *     mtime granularity is often one second, so two writes inside the same
 *     second are indistinguishable by timestamp alone — exactly the bug
 *     ARCHITECTURE.md ("Source of truth & sync") calls out. If content moved,
 *     `write()` merges (`weekspan-core`'s three-way `merge`) instead of
 *     clobbering, and returns what is now actually on disk.
 *
 *   - `hasChanged()` has a different, cheaper contract (see `FileStore.ts`): it
 *     backs a 2-second poll rather than a write, and only needs to notice a
 *     change *eventually*. So it uses `lastModified` as a fast first filter —
 *     if the browser hasn't moved the mtime since we last looked, skip the
 *     read entirely — and only pays for a full read+compare once it has. A
 *     same-second external edit can in theory be missed for one poll tick; it
 *     surfaces on the next tick once the mtime rolls over. The actual
 *     no-clobber guarantee lives entirely in `write()`, which has no such
 *     blind spot.
 *
 * `writeArchive` / `ensureSchemaFile` / `listWeekspanFiles` mirror
 * `packages/cli/src/io.ts`'s `writeArchive` / `ensureSchemaFile` for the same
 * reasons — archiving a closed week must never silently clobber an existing
 * one, and the schema file must never silently clobber a newer one.
 */
export class FileSystemStore implements FileStore {
  readonly name: string
  private readonly dirHandle: FileSystemDirectoryHandle
  private readonly fileName: string
  /** Resolved lazily and cached — `getFileHandle` is async, so it can't happen in the constructor. */
  private fileHandle: FileSystemFileHandle | null = null
  /** mtime as of the last time we actually read the file's bytes. */
  private lastKnownModified: number | null = null

  constructor(dirHandle: FileSystemDirectoryHandle, fileName: string) {
    this.dirHandle = dirHandle
    this.fileName = fileName
    this.name = fileName
  }

  async read(): Promise<string | null> {
    return this.readCurrentText()
  }

  async hasChanged(baseline: string | null): Promise<boolean> {
    const handle = await this.getFileHandle()
    const file = await handle.getFile()
    if (this.lastKnownModified !== null && file.lastModified === this.lastKnownModified) {
      // mtime hasn't moved since we last actually looked: nothing to see, and
      // this is the common case on every poll tick, so skip the read.
      return false
    }
    this.lastKnownModified = file.lastModified
    const text = await file.text()
    const current = text.length === 0 ? null : text
    return current !== baseline
  }

  async write(next: string, baseline: string | null): Promise<WriteResult> {
    const current = await this.readCurrentText()

    if (current === baseline) {
      // Nobody else touched the file since we last read it: safe to write
      // directly. Skip the actual write when it would be a byte-for-byte
      // no-op, so an idempotent save doesn't touch mtime or churn a synced
      // folder.
      if (next !== (current ?? '')) {
        await this.writeText(next)
      }
      return { text: next, merged: false, conflicts: [] }
    }

    // Someone else — another tab, the CLI, an agent — wrote while we were
    // working. Merge rather than clobber; this is the entire payoff of
    // parsing the file into a real structure instead of treating it as an
    // opaque blob.
    const base = baseline === null ? createWeekspan() : parse(baseline)
    const ours = parse(next)
    const theirs = current === null ? createWeekspan() : parse(current)
    const result = merge(base, ours, theirs)
    const mergedText = serialize(result.merged)

    if (mergedText !== (current ?? '')) {
      await this.writeText(mergedText)
    }
    return { text: mergedText, merged: true, conflicts: result.conflicts }
  }

  /** Write one closed-out week's archive to `archive/<week>.json` beside this file. Refuses to overwrite. */
  async writeArchive(archive: ArchiveFile): Promise<string> {
    return writeArchiveIn(this.dirHandle, archive)
  }

  /** Make sure `weekspan.schema.json` sits beside this file. Never overwrites. */
  async ensureSchemaFile(schemaJson: string): Promise<boolean> {
    return ensureSchemaFileIn(this.dirHandle, schemaJson)
  }

  /** List every `*.weekspan.json` file in the bound directory, for the ledger dropdown. */
  async listWeekspanFiles(): Promise<string[]> {
    return listWeekspanFilesIn(this.dirHandle)
  }

  private async getFileHandle(): Promise<FileSystemFileHandle> {
    if (!this.fileHandle) {
      this.fileHandle = await this.dirHandle.getFileHandle(this.fileName)
    }
    return this.fileHandle
  }

  /** Read current bytes, updating the mtime cache used by `hasChanged`. Empty file reads as null. */
  private async readCurrentText(): Promise<string | null> {
    const handle = await this.getFileHandle()
    const file = await handle.getFile()
    this.lastKnownModified = file.lastModified
    const text = await file.text()
    return text.length === 0 ? null : text
  }

  /**
   * The browser writes to a temp file and swaps it in on `close()`, so
   * atomicity of the on-disk result is handled for us. What is NOT handled
   * for us is the writable stream itself: if `write()` throws, the stream
   * must still be released rather than left open (which would keep the file
   * locked for any other write attempt), hence try/finally rather than a
   * bare await.
   */
  private async writeText(text: string): Promise<void> {
    const handle = await this.getFileHandle()
    await writeWholeFile(handle, text)
    // Refresh the mtime cache to the file we just produced, so the next
    // `hasChanged` poll doesn't immediately re-read our own write.
    try {
      const file = await handle.getFile()
      this.lastKnownModified = file.lastModified
    } catch {
      // Non-fatal: worst case is one extra content read on the next poll.
    }
  }
}

/** True when `err` is the DOMException a handle throws for "no such file/directory". */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotFoundError'
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

/** Write `text` to `handle`, releasing the writable stream even if the write throws. */
async function writeWholeFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(text)
  } finally {
    await writable.close()
  }
}

/**
 * List every `*.weekspan.json` file directly inside `dir` — the candidates
 * for the ledger dropdown. A free function, not only a `FileSystemStore`
 * method, because `FilePicker` needs this BEFORE any particular file is
 * chosen — i.e. before a `FileSystemStore` can even be constructed.
 */
export async function listWeekspanFilesIn(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const handle of dir.values()) {
    if (handle.kind === 'file' && handle.name.endsWith('.weekspan.json')) {
      names.push(handle.name)
    }
  }
  return names.sort()
}

/**
 * Make sure `weekspan.schema.json` sits beside the weekspan, since `$schema`
 * in the file is the relative path `./weekspan.schema.json` and editors
 * resolve it from there. Mirrors `packages/cli/src/io.ts`'s
 * `ensureSchemaFile`. Never overwrites: a newer app version may have written
 * a newer schema.
 */
export async function ensureSchemaFileIn(dir: FileSystemDirectoryHandle, schemaJson: string): Promise<boolean> {
  const name = 'weekspan.schema.json'
  if (await fileExists(dir, name)) return false
  const handle = await dir.getFileHandle(name, { create: true })
  await writeWholeFile(handle, schemaJson)
  return true
}

/**
 * Write one closed-out week's archive to `archive/<week>.json`, creating the
 * `archive/` subdirectory if needed. Mirrors `packages/cli/src/io.ts`'s
 * `writeArchive`, and for the same reason REFUSES to overwrite an existing
 * archive: a closed week is history, and silently replacing it destroys
 * records.
 */
export async function writeArchiveIn(dir: FileSystemDirectoryHandle, archive: ArchiveFile): Promise<string> {
  const archiveDir = await dir.getDirectoryHandle('archive', { create: true })
  const fileName = `${archive.week}.json`
  if (await fileExists(archiveDir, fileName)) {
    throw new Error(`Archive archive/${fileName} already exists — refusing to overwrite a closed week.`)
  }
  const handle = await archiveDir.getFileHandle(fileName, { create: true })
  await writeWholeFile(handle, serializeArchive(archive))
  return `archive/${fileName}`
}
