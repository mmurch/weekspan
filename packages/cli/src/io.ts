import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FutureVersionError,
  ParseError,
  merge,
  parse,
  serialize,
  serializeArchive,
  type ArchiveFile,
  type Weekspan,
  type MergeConflict,
} from '@weekspan/weekspan-core'
import { CliError, EXIT } from './exit.js'
import { archiveDir, schemaPath } from './config.js'

/**
 * All weekspan file access.
 *
 * `weekspan-core` is pure and exhaustively tested, so essentially every genuinely new
 * bug in this CLI lives in this file. Two hazards drive the design:
 *
 * 1. The weekspan normally sits in a Drive/Dropbox folder. A partial write does not
 *    just corrupt a local file — it replicates to every device within seconds.
 *    So writes are atomic: temp file in the SAME directory, fsync, then rename.
 *    Rename is atomic within a filesystem; a crash leaves either the old file or
 *    the new one, never a half-written one.
 *
 * 2. A browser tab may write between our read and our write. Rather than clobber,
 *    we re-read and run weekspan-core's semantic merge. That is the whole payoff of
 *    having a real three-way merge: a CLI write racing a UI write loses neither.
 */

export interface LoadedWeekspan {
  path: string
  weekspan: Weekspan
  /** Exactly what was on disk — the merge base, and the staleness reference. */
  baselineText: string
  baseline: Weekspan
}

export interface SaveResult {
  /** False when the file was already byte-identical: a no-op command writes nothing. */
  written: boolean
  /** True when a concurrent change was detected and merged in. */
  merged: boolean
  conflicts: MergeConflict[]
}

export async function loadWeekspan(weekspanPath: string): Promise<LoadedWeekspan> {
  let text: string
  try {
    text = await readFile(weekspanPath, 'utf8')
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      throw new CliError(
        `No weekspan at ${weekspanPath}\nCreate one with:  weekspan init --weekspan ${weekspanPath}`,
        EXIT.FILE,
      )
    }
    throw new CliError(`Cannot read ${weekspanPath}: ${e.message}`, EXIT.FILE)
  }

  return { path: weekspanPath, weekspan: parseOrExplain(text, weekspanPath), baselineText: text, baseline: parseOrExplain(text, weekspanPath) }
}

function parseOrExplain(text: string, weekspanPath: string): Weekspan {
  try {
    return parse(text)
  } catch (err) {
    if (err instanceof FutureVersionError) {
      // Deliberately suggests nothing that writes. An older client "fixing" a newer
      // file would drop fields it does not understand and replicate that loss.
      throw new CliError(
        `${weekspanPath} was written by a newer version of this tool ` +
          `(file version ${err.fileVersion}, this build understands ${err.supportedVersion}).\n` +
          `Update the CLI. Do not edit the file with this version.`,
        EXIT.FILE,
      )
    }
    if (err instanceof ParseError) {
      throw new CliError(`${weekspanPath} is not a valid weekspan:\n  ${err.message}`, EXIT.FILE)
    }
    throw new CliError(`${weekspanPath} could not be read: ${(err as Error).message}`, EXIT.FILE)
  }
}

/**
 * Write `next`, merging first if the file changed under us.
 *
 * Staleness is detected by comparing FILE CONTENT, not mtime. Many filesystems
 * report mtime at 1-second granularity, so two writes inside the same second are
 * indistinguishable by timestamp — and this is a tool where a script might make
 * several edits in a row. Content comparison has no such blind spot, and the file
 * is a few KB, so re-reading costs nothing.
 *
 * A race still exists between this read and the rename below. Closing it fully
 * needs a lock file, which brings its own failure mode (stale locks after a crash).
 * For one user across a laptop, a phone and an occasional agent, a microsecond
 * window is not worth that, but the tradeoff is deliberate rather than overlooked.
 */
export async function saveWeekspan(loaded: LoadedWeekspan, next: Weekspan): Promise<SaveResult> {
  const nextText = serialize(next)

  let currentText: string
  try {
    currentText = await readFile(loaded.path, 'utf8')
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      throw new CliError(`Cannot re-read ${loaded.path}: ${e.message}`, EXIT.FILE)
    }
    // Deleted under us. Treat our state as authoritative rather than losing the edit.
    currentText = loaded.baselineText
  }

  if (currentText === loaded.baselineText) {
    if (nextText === currentText) return { written: false, merged: false, conflicts: [] }
    await atomicWrite(loaded.path, nextText)
    return { written: true, merged: false, conflicts: [] }
  }

  // Someone wrote while we were working. Merge rather than clobber.
  const theirs = parseOrExplain(currentText, loaded.path)
  const result = merge(loaded.baseline, next, theirs)
  const mergedText = serialize(result.merged)

  if (mergedText === currentText) {
    return { written: false, merged: true, conflicts: result.conflicts }
  }
  await atomicWrite(loaded.path, mergedText)
  return { written: true, merged: true, conflicts: result.conflicts }
}

/**
 * Temp file in the same directory, fsync, rename.
 *
 * Same directory matters: `rename` is only atomic within a filesystem, so a temp
 * file in /tmp could land on a different device and degrade to a copy — which is
 * exactly the non-atomic write this exists to prevent.
 */
export async function atomicWrite(target: string, contents: string): Promise<void> {
  const dir = path.dirname(target)
  const unique = createHash('sha1')
    .update(`${process.pid}:${target}:${contents.length}`)
    .digest('hex')
    .slice(0, 8)
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${unique}`)

  let handle
  try {
    handle = await open(tmp, 'w')
    await handle.writeFile(contents, 'utf8')
    // Without fsync, rename can be durable while the DATA is still buffered —
    // a power loss then yields an intact-looking file with truncated contents.
    await handle.sync()
  } catch (err) {
    throw new CliError(`Cannot write ${target}: ${(err as Error).message}`, EXIT.FILE)
  } finally {
    await handle?.close()
  }

  try {
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw new CliError(`Cannot replace ${target}: ${(err as Error).message}`, EXIT.FILE)
  }
}

/** Create a weekspan file, refusing to clobber an existing one. */
export async function createWeekspanFile(weekspanPath: string, weekspan: Weekspan): Promise<void> {
  if (existsSync(weekspanPath)) {
    throw new CliError(`${weekspanPath} already exists. Refusing to overwrite.`, EXIT.CONFLICT)
  }
  mkdirSync(path.dirname(weekspanPath), { recursive: true })
  await atomicWrite(weekspanPath, serialize(weekspan))
}

/** Write one closed-out week's archive beside the weekspan. */
export async function writeArchive(weekspanPath: string, archive: ArchiveFile): Promise<string> {
  const dir = archiveDir(weekspanPath)
  mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `${archive.week}.json`)
  if (existsSync(target)) {
    throw new CliError(
      `Archive ${target} already exists — refusing to overwrite a closed week.`,
      EXIT.CONFLICT,
    )
  }
  await atomicWrite(target, serializeArchive(archive))
  return target
}

/**
 * Make sure `weekspan.schema.json` sits beside the weekspan, since `$schema` in the
 * file is the relative path `./weekspan.schema.json` and editors resolve it from there.
 * Never overwrites: a newer app version may have written a newer schema.
 */
export async function ensureSchemaFile(weekspanPath: string, schemaJson: string): Promise<boolean> {
  const target = schemaPath(weekspanPath)
  if (existsSync(target)) return false
  mkdirSync(path.dirname(target), { recursive: true })
  await writeFile(target, schemaJson, 'utf8')
  return true
}
