import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FutureVersionError,
  ParseError,
  merge,
  parse,
  serialize,
  type ArchiveFile,
  type Weekspan,
} from '@weekspan/weekspan-core'
import type { FileStore, StoreStatus, WriteResult } from './FileStore.js'

/**
 * The single mutation path.
 *
 * Every change to the weekspan goes through `mutate`, for the same reason the
 * CLI routes everything through one wrapper: surfacing merge conflicts has to be
 * structural. If individual components wrote to the store directly, one that
 * forgot to report a conflict would silently discard another device's edit.
 *
 * `apply` returns the next weekspan, or null meaning "nothing to do" — which
 * writes nothing at all, so a no-op interaction produces no file change and no
 * diff in a synced folder.
 */

export interface WeekspanStore {
  status: StoreStatus
  /** The current weekspan, or null before one is loaded. */
  weekspan: Weekspan | null
  mutate: (apply: (w: Weekspan) => Weekspan | null) => Promise<void>
  /**
   * A mutation that also emits archive files — close-out is the only one.
   *
   * Archives are written BEFORE the trimmed weekspan, deliberately: if the
   * process dies between the two, an orphaned archive is recoverable, whereas a
   * weekspan with items removed and no archive is permanent loss. Same ordering
   * the CLI uses.
   *
   * Kept generic (it knows nothing about close-out) so the store does not have
   * to import the close-out logic.
   */
  mutateWithArchives: (
    apply: (w: Weekspan) => { weekspan: Weekspan; archives: ArchiveFile[] } | null,
  ) => Promise<void>
  /** Re-read from the store, discarding nothing (the file is truth). */
  reload: () => Promise<void>
  /** Conflicts from the most recent write, for the UI to surface. */
  lastConflicts: WriteResult['conflicts']
  /** True when the last write had to merge in someone else's changes. */
  lastMerged: boolean
}

const POLL_MS = 2000

export function useWeekspan(store: FileStore | null, pollMs = POLL_MS): WeekspanStore {
  const [status, setStatus] = useState<StoreStatus>({ kind: 'unbound' })
  const [lastConflicts, setLastConflicts] = useState<WriteResult['conflicts']>([])
  const [lastMerged, setLastMerged] = useState(false)

  /** Exactly what we last read. The merge base, and the staleness reference. */
  const baseline = useRef<string | null>(null)
  /** Guards against a poll landing mid-write and reverting it. */
  const writing = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    if (!store) {
      setStatus({ kind: 'unbound' })
      return
    }
    setStatus({ kind: 'loading' })
    try {
      const text = await store.read()
      if (text === null) {
        setStatus({ kind: 'unbound' })
        return
      }
      baseline.current = text
      setStatus({ kind: 'ready', weekspan: parse(text) })
    } catch (err) {
      setStatus(describe(err))
    }
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = useCallback(
    async (apply: (w: Weekspan) => Weekspan | null): Promise<void> => {
      if (!store || status.kind !== 'ready') return

      const next = apply(status.weekspan)
      if (next === null) return // no change: no write, no diff

      // Optimistic: the grid updates immediately, then the write settles. A
      // spreadsheet that lagged a keystroke behind the file would feel broken.
      setStatus({ kind: 'ready', weekspan: next })

      writing.current = true
      try {
        const result = await store.write(serialize(next), baseline.current)
        baseline.current = result.text
        setLastConflicts(result.conflicts)
        setLastMerged(result.merged)
        // A merge means disk now holds something other than what we sent, so the
        // merged result — not our optimistic copy — becomes the truth.
        if (result.merged) setStatus({ kind: 'ready', weekspan: parse(result.text) })
      } catch (err) {
        setStatus(describe(err))
      } finally {
        writing.current = false
      }
    },
    [store, status],
  )

  const mutateWithArchives = useCallback(
    async (
      apply: (w: Weekspan) => { weekspan: Weekspan; archives: ArchiveFile[] } | null,
    ): Promise<void> => {
      if (!store || status.kind !== 'ready') return
      const next = apply(status.weekspan)
      if (next === null) return

      writing.current = true
      try {
        // Archives first — see the doc on the interface. If any archive write
        // fails we abort BEFORE touching the weekspan, so nothing is lost.
        for (const archive of next.archives) {
          await store.writeArchive(archive)
        }
        const result = await store.write(serialize(next.weekspan), baseline.current)
        baseline.current = result.text
        setLastConflicts(result.conflicts)
        setLastMerged(result.merged)
        setStatus({ kind: 'ready', weekspan: result.merged ? parse(result.text) : next.weekspan })
      } catch (err) {
        setStatus(describe(err))
      } finally {
        writing.current = false
      }
    },
    [store, status],
  )

  // Poll for writes from the CLI, an agent, or another tab.
  useEffect(() => {
    if (!store || pollMs <= 0) return
    let cancelled = false
    const id = setInterval(() => {
      void (async () => {
        if (writing.current || cancelled) return
        try {
          if (!(await store.hasChanged(baseline.current))) return
          const text = await store.read()
          if (text === null || cancelled) return
          const theirs = parse(text)
          // Merge rather than clobber: the user may have unsaved optimistic state.
          setStatus((cur) => {
            if (cur.kind !== 'ready') return cur
            const base = baseline.current === null ? cur.weekspan : parse(baseline.current)
            const result = merge(base, cur.weekspan, theirs)
            return { kind: 'ready', weekspan: result.merged }
          })
          baseline.current = text
        } catch {
          // A transient read failure must not kill the poll loop.
        }
      })()
    }, pollMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [store, pollMs])

  return {
    status,
    weekspan: status.kind === 'ready' ? status.weekspan : null,
    mutate,
    mutateWithArchives,
    reload: load,
    lastConflicts,
    lastMerged,
  }
}

type ErrorStatus = { kind: 'error'; message: string; recoverable: boolean }

function describe(err: unknown): ErrorStatus {
  if (err instanceof FutureVersionError) {
    return {
      kind: 'error',
      // Deliberately offers nothing that writes: an older client "fixing" a newer
      // file would drop fields it does not understand and sync that loss everywhere.
      message: `This file was written by a newer version of Weekspan (file v${err.fileVersion}, this build understands v${err.supportedVersion}). Update the app — do not edit the file with this version.`,
      recoverable: false,
    }
  }
  if (err instanceof ParseError) {
    return { kind: 'error', message: `This file is not a valid weekspan: ${err.message}`, recoverable: false }
  }
  return { kind: 'error', message: (err as Error).message ?? String(err), recoverable: true }
}
