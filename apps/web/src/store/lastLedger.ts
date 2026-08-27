/**
 * Which ledger was open last, so a reload goes straight back to it.
 *
 * Only the IndexedDB key of the remembered DIRECTORY and the file name inside
 * it are stored — never a path, because the File System Access API never
 * exposes one. The directory handle itself already lives in IndexedDB (see
 * `handles.ts`); this is just the pointer saying which of them was in use.
 *
 * ## Why the picker cannot simply be skipped
 *
 * A stored handle's permission does NOT survive a browser restart: Chrome
 * silently downgrades it to `prompt`, and `requestPermission` requires a user
 * gesture, so it can never be called from a load-time effect.
 *
 * `queryPermission`, though, is just a question and needs no gesture. So the
 * restore is honest about the two cases:
 *
 *   - permission still `granted` (same session, or a browser that persisted
 *     it) — open the ledger immediately, no picker;
 *   - anything else — fall through to the picker, which already offers the
 *     remembered directory as a one-click "Reopen". That click IS the gesture.
 *
 * The result is that a plain refresh lands straight back in the grid, and a
 * cold start costs exactly one click. Pretending otherwise would mean an
 * `await requestPermission()` that silently rejects on load and leaves the app
 * looking broken.
 */

const STORAGE_KEY = 'weekspan.lastLedger'

export interface LastLedger {
  /** IndexedDB key of the directory handle in `handles.ts`. */
  key: string
  /** File name inside that directory, e.g. `personal.weekspan.json`. */
  fileName: string
}

function storageOf(explicit?: Storage): Storage | undefined {
  return explicit ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
}

export function loadLastLedger(storage?: Storage): LastLedger | null {
  const store = storageOf(storage)
  if (!store) return null

  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    // Anything malformed reads as "nothing remembered" rather than throwing on
    // the very first render — a corrupt preference must not brick the app.
    if (typeof parsed !== 'object' || parsed === null) return null
    const { key, fileName } = parsed as Record<string, unknown>
    if (typeof key !== 'string' || typeof fileName !== 'string') return null
    if (key === '' || fileName === '') return null
    return { key, fileName }
  } catch {
    return null
  }
}

export function saveLastLedger(value: LastLedger, storage?: Storage): void {
  const store = storageOf(storage)
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage unavailable/full — the app still works, it just asks next time.
  }
}

export function forgetLastLedger(storage?: Storage): void {
  const store = storageOf(storage)
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do; a stale pointer is handled by the restore path anyway.
  }
}
