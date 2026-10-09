import { useEffect, useState } from 'react'

/** Local calendar date as `YYYY-MM-DD`. */
export function isoDateOf(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Milliseconds from `now` until the next local midnight (always > 0). */
export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return Math.max(1, next.getTime() - now.getTime())
}

const systemClock = (): Date => new Date()

/**
 * The current local date, kept fresh while the page stays open.
 *
 * Without this `today` was read once at render and never again, so a tab left
 * open overnight kept highlighting yesterday, refused to close out the week,
 * and resolved the `today` keyword to the wrong day until a manual refresh.
 *
 * Updates on a timer aimed at the next local midnight, and also re-checks when
 * the tab becomes visible or gains focus — timers are throttled or skipped
 * while a laptop sleeps, so the timer alone is not enough.
 *
 * `override` (the `?today=` URL param, used by screenshots and tests) pins the
 * date and disables all of the above.
 */
export function useToday(override?: string | null, clock: () => Date = systemClock): string {
  const [today, setToday] = useState(() => override ?? isoDateOf(clock()))

  useEffect(() => {
    if (override) {
      setToday(override)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = (): void => {
      const now = clock()
      setToday(isoDateOf(now))
      if (timer !== undefined) clearTimeout(timer)
      // +1s so we land safely after midnight rather than on the boundary.
      timer = setTimeout(refresh, msUntilNextMidnight(now) + 1000)
    }
    refresh()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [override, clock])

  return today
}
