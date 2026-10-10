import { useEffect, useRef, useState } from 'react'
import { createWeekspan, serialize } from '@weekspan/weekspan-core'
import { listWeekspanFilesIn } from './FileSystemStore.js'
import './LedgerMenu.css'

/**
 * The ledger dropdown in the top bar.
 *
 * The handoff drew this as a dropdown ("this swaps between ledger files and
 * creates new ones") but it shipped as an inert `<span>` with a caret — it
 * looked like a control and did nothing, and the only way to change ledgers
 * was to clear site data so the picker came back.
 *
 * Scope is deliberately the CURRENT DIRECTORY. Sibling `*.weekspan.json` files
 * are listed and switched between in one click; anything outside needs the
 * folder picker, which is a separate entry rather than something this menu
 * tries to inline, because opening a directory requires a user gesture and a
 * native dialog either way.
 *
 * Creating a ledger writes an empty file and switches to it immediately. It
 * refuses to overwrite: a name that already exists is an error, not a silent
 * replacement of someone's data.
 */

export interface LedgerMenuProps {
  /** Name of the ledger currently open, shown as the button label. */
  name: string
  /** Directory the current ledger lives in, or null for a fixture/in-memory store. */
  dir: { handle: FileSystemDirectoryHandle; key: string } | null
  /** Bind a different file in the same directory. */
  onOpen: (handle: FileSystemDirectoryHandle, fileName: string, key: string) => void
  /** Drop back to the folder picker. */
  onPickAnotherFolder: () => void
}

export function LedgerMenu({
  name,
  dir,
  onOpen,
  onPickAnotherFolder,
}: LedgerMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<string[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Listed on open, not on mount: the directory can gain files from the CLI or
  // another app while this tab sits idle, so a list cached at mount goes stale.
  useEffect(() => {
    if (!open || !dir) return
    let cancelled = false
    void (async () => {
      try {
        const found = await listWeekspanFilesIn(dir.handle)
        if (!cancelled) setFiles(found)
      } catch {
        if (!cancelled) setFiles([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, dir])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  function close(): void {
    setOpen(false)
    setCreating(false)
    setError(null)
  }

  async function create(raw: string): Promise<void> {
    if (!dir) return
    const trimmed = raw.trim()
    if (trimmed === '') return
    // One canonical extension, so the dropdown's own listing can find it again.
    const fileName = trimmed.endsWith('.weekspan.json') ? trimmed : `${trimmed}.weekspan.json`

    try {
      const existing = await listWeekspanFilesIn(dir.handle)
      if (existing.includes(fileName)) {
        setError(`${fileName} already exists.`)
        return
      }
      const handle = await dir.handle.getFileHandle(fileName, { create: true })
      const writable = await handle.createWritable()
      await writable.write(serialize(createWeekspan()))
      await writable.close()
      onOpen(dir.handle, fileName, dir.key)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that file.')
    }
  }

  return (
    <div className="ws-ledgermenu" ref={ref}>
      <button
        className="ws-filepicker"
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {name} <span className="ws-caret">▾</span>
      </button>

      {open ? (
        <div className="ws-ledgermenu-pop" role="menu">
          {dir === null ? (
            <p className="ws-ledgermenu-note">
              This is a demo fixture, not a file on disk.
            </p>
          ) : files === null ? (
            <p className="ws-ledgermenu-note">Reading folder…</p>
          ) : (
            <>
              {files.map((file) => (
                <button
                  key={file}
                  className={`ws-ledgermenu-item${file === name ? ' ws-ledgermenu-item--active' : ''}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (file !== name) onOpen(dir.handle, file, dir.key)
                    close()
                  }}
                >
                  <span className="ws-ledgermenu-check" aria-hidden="true">
                    {file === name ? '✓' : ''}
                  </span>
                  {file}
                </button>
              ))}
              {files.length === 0 ? (
                <p className="ws-ledgermenu-note">No ledgers in this folder.</p>
              ) : null}
            </>
          )}

          <div className="ws-ledgermenu-sep" />

          {creating ? (
            <form
              className="ws-ledgermenu-new"
              onSubmit={(e) => {
                e.preventDefault()
                void create(inputRef.current?.value ?? '')
              }}
            >
              <input
                ref={inputRef}
                className="ws-ledgermenu-input"
                placeholder="work"
                aria-label="New ledger name"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setCreating(false)
                    setError(null)
                  }
                  e.stopPropagation()
                }}
              />
              <span className="ws-ledgermenu-ext">.weekspan.json</span>
            </form>
          ) : (
            <button
              className="ws-ledgermenu-item"
              type="button"
              role="menuitem"
              disabled={dir === null}
              onClick={() => setCreating(true)}
            >
              <span className="ws-ledgermenu-check" aria-hidden="true">
                +
              </span>
              New ledger…
            </button>
          )}

          <button
            className="ws-ledgermenu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              close()
              onPickAnotherFolder()
            }}
          >
            <span className="ws-ledgermenu-check" aria-hidden="true">
              ⁝
            </span>
            Open another folder…
          </button>

          {error ? <p className="ws-ledgermenu-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
