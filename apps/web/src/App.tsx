import { useCallback, useEffect, useMemo, useState } from 'react'
import { minimalMoveRank, weekOf, type Weekspan } from '@weekspan/weekspan-core'
import { Grid } from './grid/Grid.js'
import { buildGrid } from './grid/viewModel.js'
import { demoWeekspan, emptyWeekspan, stressWeekspan, wrappingWeekspan } from './grid/fixtures.js'
import { applyTheme, loadTheme, type ThemeChoice } from './theme.js'
import { Rail } from './Rail.js'
import { ShortcutBar } from './ShortcutBar.js'
import { ZoomPicker, loadZoom, useFillWeeks } from './zoom.js'
import { MemoryStore, type FileStore } from './store/FileStore.js'
import { FileSystemStore } from './store/FileSystemStore.js'
import { FilePicker } from './store/FilePicker.js'
import { useWeekspan } from './store/useWeekspan.js'
import { serialize } from '@weekspan/weekspan-core'
import { resolveKey, applyAction } from './interaction/keymap.js'
import { reconcileSelection, selectionFromCell, type Selection } from './interaction/selection.js'
import { CellMenu } from './interaction/CellMenu.js'
import { useDragReorder } from './interaction/useDragReorder.js'
import { DragIndicator } from './interaction/DragIndicator.js'
import { QuickCapture } from './add/QuickCapture.js'
import { insertItem } from './add/draft.js'
import { shouldOpenCaptureOnSpace } from './add/openCaptureOnSpace.js'
import { closeOutState, performClose } from './closeout/closeoutActions.js'
import { CloseOutPanel } from './closeout/CloseOutPanel.js'

const FIXTURES = {
  demo: demoWeekspan,
  wrapping: wrappingWeekspan,
  stress: stressWeekspan,
  empty: emptyWeekspan,
} as const

type FixtureName = keyof typeof FIXTURES

function isTheme(v: string | null): v is ThemeChoice {
  return v === 'system' || v === 'paper' || v === 'solarized' || v === 'warm'
}

function todayFromClock(): string {
  const now = new Date()
  const y = String(now.getFullYear()).padStart(4, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function App(): JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const today = params.get('today') ?? todayFromClock()
  const themeParam = params.get('theme')
  const fixtureParam = params.get('fixture')

  useEffect(() => {
    applyTheme(isTheme(themeParam) ? themeParam : loadTheme())
  }, [themeParam])

  /**
   * A `?fixture=` param binds an in-memory store instead of a real file. This is
   * what the screenshot harness and any quick look use, and it means the whole
   * app can run with no file picked and no browser API involved.
   */
  const [store, setStore] = useState<FileStore | null>(() =>
    fixtureParam ? new MemoryStore(serialize(FIXTURES[fixtureParam as FixtureName](today))) : null,
  )

  const onFileReady = useCallback(
    (dir: FileSystemDirectoryHandle, fileName: string) => {
      setStore(new FileSystemStore(dir, fileName))
    },
    [],
  )

  if (!store) return <FilePicker onFileReady={onFileReady} />
  return <Workspace store={store} today={today} />
}

function Workspace({ store, today }: { store: FileStore; today: string }): JSX.Element {
  const { status, weekspan, mutate, mutateWithArchives, lastMerged, lastConflicts } =
    useWeekspan(store)

  const [zoom, setZoom] = useState(() => loadZoom())
  const fillWeeks = useFillWeeks(zoom)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; sel: Selection } | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [closeOutOpen, setCloseOutOpen] = useState(false)

  /**
   * Zoom is applied to the document root, never to an inner element.
   *
   * CSS `zoom` creates its own coordinate space, and `getBoundingClientRect()`
   * inside a zoomed subtree reports layout rather than visual coordinates. That
   * is measurably harmless for real users — the cell menu lands exactly under the
   * cursor at 100%, 110% and 150% (`scripts/probe-zoom-coords.mjs`) — but it does
   * break synthetic clicks in automation, and it makes the whole thing easier to
   * reason about if there is only ever one coordinate space.
   *
   * Zooming the root also scales the top bar and rail, not just the grid, which
   * is what an "interface size" control should do.
   */
  useEffect(() => {
    document.documentElement.style.zoom = String(zoom)
    return () => {
      document.documentElement.style.zoom = ''
    }
  }, [zoom])

  const vm = useMemo(
    () => (weekspan ? buildGrid(weekspan, today, fillWeeks) : null),
    [weekspan, today, fillWeeks],
  )

  // A selection pointing at an item that no longer exists is worse than none —
  // keystrokes would silently act on nothing.
  useEffect(() => {
    if (vm) setSelection((cur) => reconcileSelection(cur, vm))
  }, [vm])

  /**
   * Commits a drag. All rank maths stays in weekspan-core: the drag only ever
   * names neighbour ids, and `minimalMoveRank` decides whether that even
   * requires a write. A drop that already satisfies its constraint writes
   * nothing, so a dragged-and-returned row leaves no diff in a synced folder.
   */
  const handleReorder = useCallback(
    (itemId: string, beforeId: string | null, afterId: string | null): void => {
      void mutate((w) => {
        const moving = w.items.find((i) => i.id === itemId)
        if (!moving) return null
        const before = beforeId ? (w.items.find((i) => i.id === beforeId) ?? null) : null
        const after = afterId ? (w.items.find((i) => i.id === afterId) ?? null) : null
        const rank = minimalMoveRank(moving, before, after, w.items)
        if (rank === null) return null
        return { ...w, items: w.items.map((i) => (i.id === moving.id ? { ...i, rank } : i)) }
      })
    },
    [mutate],
  )

  const { state: dragState, gripHandlers } = useDragReorder(vm, handleReorder)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCaptureOpen(true)
        return
      }
      // Space opens capture when you are not typing. Must preventDefault, since
      // space is also page-scroll.
      if (shouldOpenCaptureOnSpace(e)) {
        e.preventDefault()
        setCaptureOpen(true)
        return
      }
      if (!weekspan) return
      const action = resolveKey(e)
      if (!action) return
      if (action.kind === 'newItem') {
        e.preventDefault()
        setCaptureOpen(true)
        return
      }
      e.preventDefault()
      const result = applyAction(action, selection, weekspan, today)
      setSelection(result.selection)
      if (result.weekspan) void mutate(() => result.weekspan)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [weekspan, selection, today, mutate])

  /** Menu entries route through the same pure reducer the keyboard uses, so the
   *  two paths cannot drift (e.g. vacation-day refusal applying to one but not
   *  the other). */
  function runMenuAction(kind: 'setDone' | 'setDue' | 'clear'): void {
    if (!weekspan || !menu) return
    const result = applyAction({ kind }, menu.sel, weekspan, today)
    if (result.weekspan) void mutate(() => result.weekspan)
    setMenu(null)
  }

  if (status.kind === 'loading') return <Splash>Loading…</Splash>
  if (status.kind === 'error') {
    return (
      <Splash>
        <strong>Could not open this weekspan.</strong>
        <p>{status.message}</p>
      </Splash>
    )
  }
  if (!weekspan || !vm) return <Splash>No weekspan loaded.</Splash>

  const closeState = closeOutState(weekspan, today)
  const preview = closeState.closeable ? performClose(weekspan, today) : null

  return (
    <div className="ws-shell">
      <Rail projectColors={[...new Set(vm.rows.map((r) => r.projectColorToken).filter(Boolean))] as string[]} />
      <div className="ws-main">
        <TopBar today={today} name={store.name} zoom={zoom} onZoom={setZoom} />
        {lastMerged ? (
          <Banner>
            Another writer changed this file; changes were merged.
            {lastConflicts.length > 0
              ? ` ${lastConflicts.length} conflict(s) resolved toward this session.`
              : null}
          </Banner>
        ) : null}
        <div className="ws-scroll">
          <Grid
            vm={vm}
            selection={selection}
            onSelectCell={(itemId, date) => {
              // Click both selects AND advances the cell, per the request that a
              // click cycle blank -> due -> done -> blank (plus skip when the item
              // recurs). Routed through the same `cycle` action Enter uses, so the
              // two can never diverge — including the vacation-day refusal.
              const sel = selectionFromCell(itemId, date)
              setSelection(sel)
              const result = applyAction({ kind: 'cycle' }, sel, weekspan, today)
              if (result.weekspan) void mutate(() => result.weekspan)
            }}
            onContextCell={(itemId, date, x, y) =>
              setMenu({ x, y, sel: selectionFromCell(itemId, date) })
            }
            onCloseOut={() => setCloseOutOpen(true)}
            gripHandlers={gripHandlers}
          />
          <DragIndicator vm={vm} state={dragState} />
        </div>
        <ShortcutBar count={vm.rows.length} />
      </div>

      {menu ? (
        <CellMenu
          position={{ x: menu.x, y: menu.y }}
          cell={{ itemId: menu.sel.itemId, date: menu.sel.date }}
          onMarkDone={() => runMenuAction('setDone')}
          onSetDue={() => runMenuAction('setDue')}
          onClear={() => runMenuAction('clear')}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {captureOpen ? (
        <QuickCapture
          projects={weekspan.projects}
          today={today}
          onClose={() => setCaptureOpen(false)}
          onSubmit={(capture, position) => {
            void mutate((w) => {
              try {
                const roots = w.items.filter((i) => i.parentId == null)
                const anchorTop = roots[0]?.id
                const anchorEnd = roots[roots.length - 1]?.id
                return insertItem(w, {
                  title: capture.title,
                  // An empty weekspan has no anchor at all; omit rather than pass
                  // undefined, which exactOptionalPropertyTypes rejects.
                  ...(position === 'top'
                    ? anchorTop
                      ? { beforeId: anchorTop }
                      : {}
                    : anchorEnd
                      ? { afterId: anchorEnd }
                      : {}),
                  ...(capture.due ? { due: capture.due } : {}),
                  ...(capture.projectId ? { projectId: capture.projectId } : {}),
                }).weekspan
              } catch {
                // insertItem throws on an empty title or a bad anchor. Refusing to
                // write is the right outcome; crashing the app is not.
                return null
              }
            })
            setCaptureOpen(false)
          }}
        />
      ) : null}

      {closeOutOpen ? (
        <CloseOutPanel
          state={closeState}
          archivePreview={preview?.archived ?? []}
          remainingCount={preview ? preview.weekspan.items.length : weekspan.items.length}
          onDismiss={() => setCloseOutOpen(false)}
          onConfirm={() => {
            void mutateWithArchives((w) => {
              const result = performClose(w, today)
              if (!result) return null
              return {
                weekspan: result.weekspan,
                archives: [{ version: 1, week: result.week, items: result.archived }],
              }
            })
            setCloseOutOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function Splash({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="ws-splash">{children}</div>
}

function Banner({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="ws-banner">{children}</div>
}

function TopBar({
  today,
  name,
  zoom,
  onZoom,
}: {
  today: string
  name: string
  zoom: number
  onZoom: (z: number) => void
}): JSX.Element {
  const label = new Date(`${today}T00:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '')
  return (
    <div className="ws-topbar">
      <span className="ws-filepicker">
        {name} <span className="ws-caret">▾</span>
      </span>
      <span className="ws-seg ws-seg--active">Priority</span>
      <span className="ws-seg">Project</span>
      <span className="ws-filter">/ filter</span>
      <span className="ws-topbar-spacer" />
      <ZoomPicker zoom={zoom} onZoom={onZoom} />
      <span className="ws-date">{label}</span>
      <span className="ws-week">{weekOf(today)}</span>
    </div>
  )
}
