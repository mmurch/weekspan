import { createArchive, serialize } from '@weekspan/weekspan-core'
import type { ArchiveFile, IsoWeek, Item, Weekspan } from '@weekspan/weekspan-core'
import type { FileStore, WriteResult } from './FileStore.js'

/**
 * Persist what `performClose` / `performAutoClose`
 * (`closeout/closeoutActions.ts`) computed purely in memory: the archive(s),
 * THEN the trimmed weekspan.
 *
 * ORDER MATTERS, mirroring `packages/cli/src/commands/closeout.ts`'s own
 * comment: if the archive write fails, or the process dies between the two
 * writes, an orphaned archive file is recoverable — a weekspan with items
 * already removed and no archive written is permanent data loss. So the
 * archive write is awaited — and left to throw, aborting the whole
 * operation — before the weekspan write is even attempted.
 *
 * Lives here (`store/`) rather than in `closeout/closeoutActions.ts` because
 * that module is deliberately pure, doing no I/O (see its own doc comment:
 * "Persisting those archive files ... is the FileStore layer's job"). This
 * is that FileStore-layer half of the same feature. Nothing wires it into the
 * UI yet — `useWeekspan.ts`'s `mutate` doesn't know about archives — so a
 * caller currently has to call this explicitly alongside a close-out action.
 */

/** What `performClose` returns, imported by shape rather than by importing closeout/ (out of scope here). */
export interface CloseResult {
  weekspan: Weekspan
  archived: Item[]
  week: IsoWeek
}

/** What `performAutoClose` returns. */
export interface AutoCloseResult {
  weekspan: Weekspan
  archives: ArchiveFile[]
}

/** Persist a single `performClose` result: archive first, then the weekspan. */
export async function persistClose(
  store: FileStore,
  baseline: string | null,
  result: CloseResult,
): Promise<WriteResult> {
  await store.writeArchive(createArchive(result.week, result.archived))
  return store.write(serialize(result.weekspan), baseline)
}

/**
 * Persist a `performAutoClose` result: every archive first (in the order
 * `result.archives` lists them — oldest week first, matching `autoClose`),
 * then a single weekspan write.
 */
export async function persistAutoClose(
  store: FileStore,
  baseline: string | null,
  result: AutoCloseResult,
): Promise<WriteResult> {
  for (const archive of result.archives) {
    await store.writeArchive(archive)
  }
  return store.write(serialize(result.weekspan), baseline)
}
