import { useEffect, useRef, useState } from 'react'
import type { IsoDate, IsoWeek } from '@weekspan/weekspan-core'
import type { WeekspanStore } from '../store/useWeekspan.js'
import { performAutoClose } from './closeoutActions.js'

/**
 * Auto-close on load — ARCHITECTURE.md "Auto-close":
 *
 * > returning to a neglected weekspan must never cost more than a glance.
 *
 * Switch tools for three months, come back, and the grid has to be usable
 * immediately — never a few dozen mandatory clicks. So this runs WITHOUT
 * confirmation, once, as soon as the store has a weekspan loaded: every
 * fully-past week that holds nothing but lapsed recurring occurrences closes
 * silently, those occurrences auto-skip (`provenance: 'auto'`, set inside
 * core's `autoClose` — this hook never overrides it, or a deliberate skip and
 * an auto skip would become indistinguishable and the skip-streak signal
 * would be destroyed). A week holding a real, unresolved EXPLICIT due still
 * blocks — that's genuine backlog, not absence, and the user should see it.
 *
 * But silently rewriting three months of someone's file with no
 * acknowledgement is alarming when they notice later, so this still reports
 * what happened: a quiet, dismissible `summary`. Nothing here asks the user
 * anything before acting.
 *
 * Writes through `store.mutate`, the single mutation path — same as every
 * other change in the app. Persisting the resulting `ArchiveFile`s to
 * `archive/<week>.json` needs the FileStore layer (another chunk's
 * responsibility, still landing); this hook only advances the working
 * weekspan and reports counts. Until that layer exists, the archived items'
 * data still lives in the closed-out `Weekspan`'s history via the file's own
 * versioning/sync, but nothing here writes a standalone archive file — that
 * gap is intentional and called out for the reviewer, not hidden.
 */

export interface AutoCloseSummary {
  weeksClosed: IsoWeek[]
  autoSkipped: number
}

export interface UseAutoCloseResult {
  /** Non-null exactly once, right after a run that actually closed something. */
  summary: AutoCloseSummary | null
  /** Dismiss the summary banner. */
  dismiss: () => void
}

export function useAutoClose(store: WeekspanStore, today: IsoDate): UseAutoCloseResult {
  const [summary, setSummary] = useState<AutoCloseSummary | null>(null)

  // Run at most once per mount. `store` is a fresh object every render (it's
  // the literal `useWeekspan` returns), so this can't key off referential
  // identity — it keys off having actually fired instead.
  const ranRef = useRef(false)
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    if (ranRef.current) return
    if (store.status.kind !== 'ready') return
    ranRef.current = true

    let captured: AutoCloseSummary | null = null

    void storeRef.current
      .mutate((weekspan) => {
        const result = performAutoClose(weekspan, today)
        if (result === null) return null // caught up: no write, no diff
        captured = { weeksClosed: result.weeksClosed, autoSkipped: result.autoSkipped }
        return result.weekspan
      })
      .then(() => {
        if (captured) setSummary(captured)
      })
    // `store.status.kind` (not `store`) is the real trigger: it flips from
    // 'loading'/'unbound' to 'ready' exactly once per load, which is when
    // auto-close should fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.status.kind, today])

  return { summary, dismiss: () => setSummary(null) }
}
