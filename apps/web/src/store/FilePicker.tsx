/// <reference types="wicg-file-system-access" />

import { useEffect, useRef, useState } from 'react'
import { createWeekspan, serialize } from '@weekspan/weekspan-core'
import { ensurePermission, forgetHandle, listHandles, loadHandle, saveHandle } from './handles.js'
import { listWeekspanFilesIn } from './FileSystemStore.js'
import './FilePicker.css'

/**
 * Presentational directory-binding UI. Owns the one browser-gated action —
 * `showDirectoryPicker` — and the "recent folders" list backed by
 * `handles.ts`. Everything else (constructing a `FileSystemStore`, wiring it
 * into `useWeekspan`) is the caller's job; this component only ever reports a
 * confirmed-usable `FileSystemDirectoryHandle` + chosen file name back via
 * `onFileReady`.
 *
 * Binding is a DIRECTORY, not a single file — see ARCHITECTURE.md
 * ("Deployment" → "Known gaps"): a file handle has no `getParent()`, so
 * writing `archive/<week>.json` or `weekspan.schema.json` beside the working
 * file, or listing sibling `*.weekspan.json` files for the ledger, is
 * structurally impossible starting from a file handle alone. Picking a
 * directory instead means one permission grant covers all three.
 *
 * The permission re-grant is the expected path on *every* fresh session, not
 * an error state: Chrome does not persist a `granted` permission across a
 * browser restart even though the handle survives in IndexedDB. So a stored
 * directory whose permission has lapsed gets a plain, one-click "Reopen"
 * button rather than being hidden or shown as broken.
 */

export interface FilePickerProps {
  /**
   * Called once a directory AND a specific `*.weekspan.json` file inside it
   * are confirmed usable — permission granted, directory persisted for next
   * time.
   */
  onFileReady: (dirHandle: FileSystemDirectoryHandle, fileName: string, key: string) => void
}

interface StoredDir {
  key: string
  name: string
  /** Whether `readwrite` permission is currently granted, as of the last check. */
  granted: boolean
  /** `*.weekspan.json` files found inside, once listed (requires permission). Null until listed. */
  files: string[] | null
}

/** True for "user closed the native dialog without choosing anything" — not a real error. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Derive a stable IndexedDB key from a directory name — good enough for a local, per-device list. */
function keyFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || name
}

/** `personal.weekspan.json`, then `personal-2.weekspan.json`, ... avoiding collisions with `existing`. */
function nextDefaultName(existing: string[]): string {
  const taken = new Set(existing)
  let candidate = 'personal.weekspan.json'
  let n = 2
  while (taken.has(candidate)) {
    candidate = `personal-${n}.weekspan.json`
    n++
  }
  return candidate
}

export function FilePicker({ onFileReady }: FilePickerProps): JSX.Element {
  const supported = typeof window.showDirectoryPicker === 'function'
  const [dirs, setDirs] = useState<StoredDir[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Handles themselves are not serializable UI state; keep them out of React state.
  const handlesRef = useRef(new Map<string, FileSystemDirectoryHandle>())

  useEffect(() => {
    if (!supported) {
      setLoadingList(false)
      return
    }
    let cancelled = false
    void (async () => {
      const entries = await listHandles()
      const withStatus: StoredDir[] = []
      for (const { key, name } of entries) {
        const handle = await loadHandle(key)
        if (!handle) continue
        handlesRef.current.set(key, handle)
        // queryPermission never prompts, so this is safe to run on load —
        // only requestPermission (inside a click handler below) needs a gesture.
        const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
        let files: string[] | null = null
        if (granted) {
          try {
            files = await listWeekspanFilesIn(handle)
          } catch {
            files = null // leave unlisted; Reopen (or a retry) can pick it up
          }
        }
        withStatus.push({ key, name, granted, files })
      }
      if (!cancelled) {
        setDirs(withStatus)
        setLoadingList(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supported])

  function upsert(entry: StoredDir): void {
    setDirs((prev) => [entry, ...prev.filter((d) => d.key !== entry.key)])
  }

  async function bindDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
    const key = keyFor(handle.name)
    await saveHandle(key, handle)
    handlesRef.current.set(key, handle)
    const files = await listWeekspanFilesIn(handle)
    upsert({ key, name: handle.name, granted: true, files })
    if (files.length === 1) {
      // The unambiguous case: exactly one weekspan file, open it immediately.
      onFileReady(handle, files[0]!, key)
    }
    // Zero or multiple files: fall through to the per-directory chooser
    // rendered below rather than guessing which file the user means.
  }

  async function handleOpen(): Promise<void> {
    setError(null)
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      await bindDirectory(handle)
    } catch (err) {
      if (!isAbort(err)) setError(describeError(err))
    }
  }

  function handleChooseFile(entry: StoredDir, fileName: string): void {
    const handle = handlesRef.current.get(entry.key)
    if (!handle) return
    onFileReady(handle, fileName, entry.key)
  }

  async function handleCreateFile(entry: StoredDir): Promise<void> {
    const handle = handlesRef.current.get(entry.key)
    if (!handle) return
    setError(null)
    setBusyKey(entry.key)
    try {
      const fileName = nextDefaultName(entry.files ?? [])
      const fileHandle = await handle.getFileHandle(fileName, { create: true })
      // Seed a genuinely usable file rather than leaving it at 0 bytes, which
      // `FileSystemStore.read()` would report as null (unbound).
      const writable = await fileHandle.createWritable()
      try {
        await writable.write(serialize(createWeekspan()))
      } finally {
        await writable.close()
      }
      const files = await listWeekspanFilesIn(handle)
      upsert({ ...entry, files })
      onFileReady(handle, fileName, entry.key)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleReopen(entry: StoredDir): Promise<void> {
    const handle = handlesRef.current.get(entry.key)
    if (!handle) return
    setError(null)
    setBusyKey(entry.key)
    try {
      const granted = await ensurePermission(handle, 'readwrite')
      if (granted) {
        const files = await listWeekspanFilesIn(handle)
        upsert({ ...entry, granted: true, files })
        if (files.length === 1) onFileReady(handle, files[0]!, entry.key)
      } else {
        setError(`Permission was not granted for "${entry.name}".`)
      }
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleForget(key: string): Promise<void> {
    await forgetHandle(key)
    handlesRef.current.delete(key)
    setDirs((prev) => prev.filter((d) => d.key !== key))
  }

  if (!supported) {
    return (
      <div className="ws-filepicker-panel">
        <div className="ws-filepicker-card">
          <h1 className="ws-filepicker-title">Open a weekspan</h1>
          <p className="ws-filepicker-desc">
            This browser doesn&apos;t support the File System Access API. Open Weekspan in Chrome or Edge to
            bind a folder.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="ws-filepicker-panel">
      <div className="ws-filepicker-card">
        <h1 className="ws-filepicker-title">Open a weekspan</h1>
        <p className="ws-filepicker-desc">
          Choose a folder to store your weekspan files in, or reopen one you&apos;ve used before.
        </p>

        <div className="ws-filepicker-actions">
          <button type="button" className="ws-filepicker-primary" onClick={() => void handleOpen()}>
            Open a folder…
          </button>
        </div>

        <div className="ws-filepicker-recent">
          {loadingList ? (
            <p className="ws-filepicker-hint">Loading recent folders…</p>
          ) : dirs.length > 0 ? (
            <>
              <p className="ws-filepicker-label">Recent folders</p>
              <ul className="ws-filepicker-list">
                {dirs.map((d) => (
                  <li key={d.key} className="ws-filepicker-item">
                    <div className="ws-filepicker-dirname">
                      <span className="ws-mono ws-filepicker-dirname-text">{d.name}</span>
                      <button
                        type="button"
                        className="ws-filepicker-forget"
                        title={`Forget ${d.name}`}
                        onClick={() => void handleForget(d.key)}
                      >
                        ×
                      </button>
                    </div>

                    {!d.granted ? (
                      <button
                        type="button"
                        className="ws-filepicker-secondary"
                        disabled={busyKey === d.key}
                        onClick={() => void handleReopen(d)}
                      >
                        {busyKey === d.key ? 'Requesting…' : `Reopen ${d.name}`}
                      </button>
                    ) : d.files === null ? (
                      <p className="ws-filepicker-hint">Could not list files in this folder.</p>
                    ) : (
                      <ul className="ws-filepicker-files">
                        {d.files.map((f) => (
                          <li key={f}>
                            <button
                              type="button"
                              className="ws-filepicker-file"
                              onClick={() => handleChooseFile(d, f)}
                            >
                              <span className="ws-mono">{f}</span>
                            </button>
                          </li>
                        ))}
                        <li>
                          <button
                            type="button"
                            className="ws-filepicker-secondary"
                            disabled={busyKey === d.key}
                            onClick={() => void handleCreateFile(d)}
                          >
                            {busyKey === d.key
                              ? 'Creating…'
                              : d.files.length === 0
                                ? 'Create a weekspan file…'
                                : '+ New file…'}
                          </button>
                        </li>
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="ws-filepicker-hint">No folders opened yet.</p>
          )}
        </div>

        {error && <p className="ws-filepicker-error">{error}</p>}
      </div>
    </div>
  )
}
