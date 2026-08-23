/// <reference types="wicg-file-system-access" />

/**
 * IndexedDB persistence for `FileSystemDirectoryHandle`s, plus the permission
 * dance that goes with reusing one across sessions.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable (browsers special-case
 * it, the same way they special-case `File`/`Blob`/`FileSystemFileHandle`),
 * so it can be stored in IndexedDB directly — no serialization of a path or
 * any such thing, because there IS no path exposed to the page. This is what
 * lets the app remember "the personal weekspan folder" across a reload
 * instead of asking the user to re-navigate a native directory dialog every
 * session.
 *
 * Binding is a DIRECTORY, not a single file — see ARCHITECTURE.md
 * ("Deployment" → "Known gaps"): a file handle has no `getParent()`, so
 * writing `archive/<week>.json`, listing sibling `*.weekspan.json` files for
 * the ledger dropdown, or writing `weekspan.schema.json` beside the working
 * file is structurally impossible from a file handle alone.
 *
 * Per ARCHITECTURE.md ("Settled during implementation"), this store is
 * per-device and never touches the weekspan file itself — a work laptop and
 * a home machine can each remember a different set of mounted directories
 * without fighting over shared content.
 *
 * A stored handle's permission does NOT persist across a session in Chrome:
 * the browser silently downgrades it back to `prompt` on restart even though
 * the handle object itself survives. `ensurePermission` is how a caller
 * re-grants it — see the doc comment below for why that has to be driven by
 * a click, not an effect.
 */

const DB_NAME = 'weekspan-handles'
const DB_VERSION = 1
const STORE_NAME = 'handles'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const req = fn(tx.objectStore(STORE_NAME))
    // Resolve on the request's own result rather than tx.oncomplete, so callers
    // get the value as soon as it's available; either event still only fires
    // after the underlying operation has succeeded.
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
  })
}

/** Save (or overwrite) a directory handle under `key`, e.g. `"personal"` or `"work"`. */
export async function saveHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  try {
    await runTx(db, 'readwrite', (store) => store.put(handle, key))
  } finally {
    db.close()
  }
}

/** Load a previously-saved directory handle, or null if `key` was never saved (or was forgotten). */
export async function loadHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  try {
    const result = await runTx<FileSystemDirectoryHandle | undefined>(db, 'readonly', (store) => store.get(key))
    return result ?? null
  } finally {
    db.close()
  }
}

/** All previously-opened directories, for a "recent folders" list so returning users click a name. */
export async function listHandles(): Promise<Array<{ key: string; name: string }>> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).openCursor()
      const results: Array<{ key: string; name: string }> = []
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(results)
          return
        }
        const handle = cursor.value as FileSystemDirectoryHandle
        results.push({ key: String(cursor.key), name: handle.name })
        cursor.continue()
      }
      req.onerror = () => reject(req.error ?? new Error('IndexedDB cursor failed'))
    })
  } finally {
    db.close()
  }
}

/** Remove a saved handle. Never throws for a key that was already absent. */
export async function forgetHandle(key: string): Promise<void> {
  const db = await openDb()
  try {
    await runTx(db, 'readwrite', (store) => store.delete(key))
  } finally {
    db.close()
  }
}

export type PermissionMode = 'read' | 'readwrite'

/**
 * Make sure `handle` is usable, requesting permission only if it isn't
 * already granted. Works for either a file or a directory handle — both
 * extend the same `FileSystemHandle` base, and permission is checked the
 * identical way for each.
 *
 * `queryPermission` is checked first because it never prompts — Chrome does
 * not persist a `granted` permission state across a browser restart even
 * though the handle itself survives in IndexedDB, so on a fresh session this
 * almost always comes back `prompt` and a re-grant is genuinely expected, not
 * an error case.
 *
 * `requestPermission` is a browser-gated method that only resolves without
 * throwing a `SecurityError` when called synchronously within a user gesture
 * (a click handler). It must never be called from an effect that runs on
 * page load — callers of this function are responsible for driving it from a
 * button ("Reopen"), which is why FilePicker.tsx exposes that as its main
 * returning-user flow rather than calling this automatically.
 */
export async function ensurePermission(
  handle: FileSystemHandle,
  mode: PermissionMode = 'readwrite',
): Promise<boolean> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode }
  if ((await handle.queryPermission(descriptor)) === 'granted') return true
  const result = await handle.requestPermission(descriptor)
  return result === 'granted'
}
