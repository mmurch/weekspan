import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FutureVersionError,
  ParseError,
  merge,
  parse,
  repairDuplicateRanks,
  serialize,
  type ArchiveFile,
  type RankRepair,
  type Weekspan,
} from '@weekspan/weekspan-core'
import type { FileStore, StoreStatus, WriteResult } from './FileStore.js'
import { emptyHistory, record, redo as redoHistory, undo as undoHistory, type History } from './history.js'

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
 *
 * ## Undo
 *
 * Undo lives here rather than in the callers, and that is the whole reason it
 * is cheap: `mutate` is the only mutation path, and `apply` already returns a
 * complete immutable `Weekspan`. So the history is literally a list of past
 * values — no command objects, no inverse operations, no call site changes.
 *
 * The stack is deliberately CONSERVATIVE, because a snapshot is whole-file
 * while every other write path merges at item and cell granularity. Restoring
 * one is last-writer-wins across the entire weekspan, so it is only safe while
 * nothing else has touched the file. Three things therefore clear it:
 *
 *   1. **A merge lands** — from the poll, or from a write that came back
 *      `merged`. Every snapshot predates that other writer's work, so undoing
 *      to one would silently discard it. This is the one genuine correctness
 *      risk in the whole feature.
 *   2. **Close-out** (`mutateWithArchives`) — a barrier, not a step. It writes
 *      `archive/<week>.json` as a side effect and `FileStore` has no delete;
 *      worse, `writeArchive` refuses to overwrite, so a redo past a close would
 *      throw. Making close-out undoable means adding deletion to the store
 *      contract, which is a much larger change than the rest of this combined.
 *   3. **An error, or a different ledger** — in both cases the snapshots
 *      describe a state that is no longer the one on disk.
 *
 * Undo itself goes through the same `write` path as everything else, so it
 * merges rather than clobbers if the file moved underneath — and that merge
 * then invalidates the stack, as above.
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
  /**
   * Ranks rewritten by the repair on the most recent load. Non-empty means the
   * file on disk was already fixed — the UI's job is only to say so, since a
   * silent repair of the ordering spine is exactly the kind of change a user
   * should be told about.
   */
  lastRepairs: readonly RankRepair[]
  /**
   * Ranks the most recent WRITE's merge had to separate because both writers
   * minted the same key.
   *
   * The 2s poll merges too, and repairs there as well — it just has no clean
   * way to report a count out of a `setStatus` updater, and does not need one:
   * the repair is already in memory, so the collision can never reach disk
   * unrepaired, and the next write reports through this.
   */
  lastRanksRepaired: number
  /** True when the last write had to merge in someone else's changes. */
  lastMerged: boolean
  /** Step back one change. A no-op when there is nothing to undo. */
  undo: () => Promise<void>
  /** Step forward again. A no-op when nothing was undone, or after a new change. */
  redo: () => Promise<void>
  /** How many steps are available in each direction, for the UI to enable on. */
  undoDepth: number
  redoDepth: number
}

const POLL_MS = 2000

/**
 * How many states to keep. At roughly 220 bytes per item serialised, a 67-item
 * weekspan is ~15KB, so 50 deep is single-digit MB worst case — and close-out
 * keeps the working file bounded, so it does not grow without limit.
 */
const MAX_HISTORY = 50

export function useWeekspan(store: FileStore | null, pollMs = POLL_MS): WeekspanStore {
  const [status, setStatus] = useState<StoreStatus>({ kind: 'unbound' })
  const [lastConflicts, setLastConflicts] = useState<WriteResult['conflicts']>([])
  const [lastRepairs, setLastRepairs] = useState<readonly RankRepair[]>([])
  const [lastRanksRepaired, setLastRanksRepaired] = useState(0)
  const [lastMerged, setLastMerged] = useState(false)

  /** Exactly what we last read. The merge base, and the staleness reference. */
  const baseline = useRef<string | null>(null)
  /** Guards against a poll landing mid-write and reverting it. */
  const writing = useRef(false)

  /** Undo/redo stacks. The mechanics live in `history.ts`; this only wires them. */
  const [history, setHistory] = useState<History<Weekspan>>(emptyHistory)

  const forgetHistory = useCallback(() => {
    setHistory(emptyHistory())
  }, [])

  const load = useCallback(async (): Promise<void> => {
    // Any (re)load means the states we remember are not this file's states.
    forgetHistory()
    setLastRepairs([])
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
      const parsed = parse(text)

      // Two items sharing a rank is RECOVERABLE, so repair it rather than
      // refusing to open the ledger — `parse` rejecting it would have turned a
      // broken Enter key into a file that will not open at all, and the files
      // that need this were written by the app's own former unbounded append,
      // not by hand. The repair is written back so the next session, the CLI
      // and any agent all see a healthy file.
      const repaired = repairDuplicateRanks(parsed.items)
      if (repaired.repairs.length === 0) {
        baseline.current = text
        setStatus({ kind: 'ready', weekspan: parsed })
        return
      }

      const next: Weekspan = { ...parsed, items: repaired.items }
      setStatus({ kind: 'ready', weekspan: next })
      setLastRepairs(repaired.repairs)
      const result = await store.write(serialize(next), text)
      baseline.current = result.text
      if (result.merged) setStatus({ kind: 'ready', weekspan: parse(result.text) })
    } catch (err) {
      setStatus(describe(err))
    }
  }, [store, forgetHistory])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Write one weekspan. Shared by `mutate`, `undo` and `redo`.
   *
   * Deliberately owns NO history — its callers do. That is what lets undo reuse
   * the whole optimistic-write-then-merge path without pushing itself back onto
   * the stack it is walking.
   */
  const commit = useCallback(
    async (next: Weekspan): Promise<void> => {
      if (!store) return

      // Optimistic: the grid updates immediately, then the write settles. A
      // spreadsheet that lagged a keystroke behind the file would feel broken.
      setStatus({ kind: 'ready', weekspan: next })

      writing.current = true
      try {
        const result = await store.write(serialize(next), baseline.current)
        baseline.current = result.text
        setLastConflicts(result.conflicts)
        setLastMerged(result.merged)
        setLastRanksRepaired(result.ranksRepaired)
        // A merge means disk now holds something other than what we sent, so the
        // merged result — not our optimistic copy — becomes the truth. Every
        // snapshot we hold predates that other writer, so the history goes too.
        if (result.merged) {
          setStatus({ kind: 'ready', weekspan: parse(result.text) })
          forgetHistory()
        }
      } catch (err) {
        setStatus(describe(err))
        forgetHistory()
      } finally {
        writing.current = false
      }
    },
    [store, forgetHistory],
  )

  const mutate = useCallback(
    async (apply: (w: Weekspan) => Weekspan | null): Promise<void> => {
      if (!store || status.kind !== 'ready') return

      const previous = status.weekspan
      const next = apply(previous)
      if (next === null) return // no change: no write, no diff, no history entry

      // Record BEFORE the write. A no-op returns above, so the stack only ever
      // grows when something actually changed.
      setHistory((h) => record(h, previous, MAX_HISTORY))

      await commit(next)
    },
    [store, status, commit],
  )

  const step = useCallback(
    async (dir: 'undo' | 'redo'): Promise<void> => {
      if (!store || status.kind !== 'ready') return
      const move = dir === 'undo' ? undoHistory : redoHistory
      const result = move(history, status.weekspan, MAX_HISTORY)
      if (result === null) return // nothing to step to: write nothing

      setHistory(result.history)
      await commit(result.target)
    },
    [store, status, commit, history],
  )

  const undo = useCallback(() => step('undo'), [step])
  const redo = useCallback(() => step('redo'), [step])

  const mutateWithArchives = useCallback(
    async (
      apply: (w: Weekspan) => { weekspan: Weekspan; archives: ArchiveFile[] } | null,
    ): Promise<void> => {
      if (!store || status.kind !== 'ready') return
      const next = apply(status.weekspan)
      if (next === null) return

      // Close-out is a BARRIER, not a step. It writes archive files as a side
      // effect and `FileStore` has no delete, so an undo could not take them
      // back — and `writeArchive` refuses to overwrite, so a redo past a close
      // would throw outright. Dropping the history is the honest outcome.
      forgetHistory()

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
        setLastRanksRepaired(result.ranksRepaired)
        setStatus({ kind: 'ready', weekspan: result.merged ? parse(result.text) : next.weekspan })
      } catch (err) {
        setStatus(describe(err))
      } finally {
        writing.current = false
      }
    },
    [store, status, forgetHistory],
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
          // Someone else's work is now folded in. Every snapshot we hold
          // predates it, so undoing to one would silently throw their edit
          // away — the one genuine correctness risk in the undo feature.
          forgetHistory()
        } catch {
          // A transient read failure must not kill the poll loop.
        }
      })()
    }, pollMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [store, pollMs, forgetHistory])

  return {
    status,
    weekspan: status.kind === 'ready' ? status.weekspan : null,
    mutate,
    mutateWithArchives,
    reload: load,
    lastConflicts,
    lastRepairs,
    lastRanksRepaired,
    lastMerged,
    undo,
    redo,
    undoDepth: history.past.length,
    redoDepth: history.future.length,
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
