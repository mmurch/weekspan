import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { minimalMoveRank, weekOf, type Weekspan } from '@weekspan/weekspan-core'
import { Grid } from './grid/Grid.js'
import { buildGrid } from './grid/viewModel.js'
import { demoWeekspan, emptyWeekspan, stressWeekspan, wrappingWeekspan } from './grid/fixtures.js'
import { applyTheme, loadTheme, saveTheme, type ThemeChoice } from './theme.js'
import { ThemePicker } from './theme/ThemePicker.js'
import { FilterField } from './filter/FilterField.js'
import { filterProjectRows, filterRows, parseFilter } from './filter/filter.js'
import { toggleVacation } from './interaction/vacation.js'
import { commitNotes } from './add/notes.js'
import { commitBulk } from './add/bulkCapture.js'
import { Notice, type NoticeMessage } from './Notice.js'
import { Rail } from './Rail.js'
import { ShortcutBar } from './ShortcutBar.js'
import { ZoomPicker, loadZoom, useFillWeeks } from './zoom.js'
import { MemoryStore, type FileStore } from './store/FileStore.js'
import { FileSystemStore } from './store/FileSystemStore.js'
import { FilePicker } from './store/FilePicker.js'
import { forgetLastLedger, loadLastLedger, saveLastLedger } from './store/lastLedger.js'
import { loadHandle } from './store/handles.js'
import { LedgerMenu } from './store/LedgerMenu.js'
import { useWeekspan } from './store/useWeekspan.js'
import { defaultInsertAnchor, itemsRemovedBy, serialize, sortByDate } from '@weekspan/weekspan-core'
import { resolveKey, applyAction } from './interaction/keymap.js'
import { reconcileSelection, selectionFromCell, type Selection } from './interaction/selection.js'
import { CellMenu } from './interaction/CellMenu.js'
import { priorityAdapter, projectAdapter, useDragPreview } from './interaction/useDragPreview.js'
import { QuickCapture } from './add/QuickCapture.js'
import { insertItem } from './add/draft.js'
import { commitEdit, type EditTarget } from './add/commitEdit.js'
import { dividerKey } from './interaction/projectDragPreview.js'

/**
 * Which seam an open draft belongs to. Mirrors the slot keys `Grid` renders
 * against, so the draft appears in the gap that was actually clicked — including
 * the two gaps with no row above them (top of Priority view, first position in a
 * project group), which a bare `afterId` could not name at all.
 */
function draftSlotKey(t: Extract<EditTarget, { kind: 'new' }>): string {
  if (t.afterId) return `after:${t.afterId}`
  if (t.projectId !== undefined) return `group:${dividerKey(t.projectId)}`
  return 'top'
}
import { commitProjectCapture } from './add/projectCapture.js'
import { buildProjectView, type ProjectRow } from './grid/projectView.js'
import { applyProjectDrop, dropFromRows } from './interaction/projectDrag.js'
import { ProjectColorPicker } from './projects/ProjectColorPicker.js'
import { loadNoProjectColor, saveNoProjectColor } from './projects/noProjectColor.js'
import { setProjectColor } from '@weekspan/weekspan-core'
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

/**
 * Where a captured item lands.
 *
 * `top` is the default (plain Enter) and means "above the first row with
 * nothing in it this week" — see `defaultInsertBeforeId`. `backlog`
 * (Alt+Enter) still means the very end, which is the whole point of having a
 * second binding.
 *
 * Returns the anchor as a spreadable fragment because `insertItem` uses
 * `exactOptionalPropertyTypes`: passing `beforeId: undefined` is a type error,
 * so an absent anchor has to be an absent KEY.
 */
function captureAnchor(
  weekspan: Weekspan,
  today: string,
  position: 'top' | 'backlog',
): { beforeId?: string; afterId?: string } {
  const roots = weekspan.items.filter((i) => i.parentId == null)
  if (roots.length === 0) return {}

  if (position === 'backlog') {
    const last = roots[roots.length - 1]?.id
    return last ? { afterId: last } : {}
  }

  return defaultInsertAnchor(weekspan, today)
}

export function App(): JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const today = params.get('today') ?? todayFromClock()
  const themeParam = params.get('theme')
  const fixtureParam = params.get('fixture')

  const [theme, setTheme] = useState<ThemeChoice>(() =>
    isTheme(themeParam) ? themeParam : loadTheme(),
  )
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  const onThemeChange = useCallback((next: ThemeChoice) => {
    saveTheme(next)
    setTheme(next)
  }, [])

  /**
   * A `?fixture=` param binds an in-memory store instead of a real file. This is
   * what the screenshot harness and any quick look use, and it means the whole
   * app can run with no file picked and no browser API involved.
   */
  const [store, setStore] = useState<FileStore | null>(() =>
    fixtureParam ? new MemoryStore(serialize(FIXTURES[fixtureParam as FixtureName](today))) : null,
  )
  /** The directory the current ledger lives in, so the dropdown can list siblings. */
  const [dir, setDir] = useState<{ handle: FileSystemDirectoryHandle; key: string } | null>(null)
  /**
   * Restoring blocks the first paint. Without it the picker flashes up for a
   * frame on every reload before the remembered ledger resolves, which reads as
   * "it forgot" even though it did not.
   */
  const [restoring, setRestoring] = useState(!fixtureParam)

  const onFileReady = useCallback(
    (handle: FileSystemDirectoryHandle, fileName: string, key: string) => {
      setStore(new FileSystemStore(handle, fileName))
      setDir({ handle, key })
      saveLastLedger({ key, fileName })
    },
    [],
  )

  // Reopen last session's ledger. See `lastLedger.ts` for why this can only
  // QUERY the permission and must fall through to the picker otherwise.
  useEffect(() => {
    if (fixtureParam) return
    let cancelled = false
    void (async () => {
      const last = loadLastLedger()
      if (!last) {
        if (!cancelled) setRestoring(false)
        return
      }
      try {
        const handle = await loadHandle(last.key)
        if (handle && (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
          if (!cancelled) onFileReady(handle, last.fileName, last.key)
        } else if (!handle) {
          // The directory was forgotten; the pointer to it is now noise.
          forgetLastLedger()
        }
      } catch {
        // A dead handle or an IndexedDB failure just means "ask the user".
      }
      if (!cancelled) setRestoring(false)
    })()
    return () => {
      cancelled = true
    }
  }, [fixtureParam, onFileReady])

  if (restoring) return <Splash>Opening…</Splash>
  if (!store) return <FilePicker onFileReady={onFileReady} />
  return (
    <Workspace
      store={store}
      dir={dir}
      today={today}
      theme={theme}
      onThemeChange={onThemeChange}
      onFileReady={onFileReady}
      onPickAnotherFolder={() => {
        setStore(null)
        setDir(null)
        forgetLastLedger()
      }}
    />
  )
}

function Workspace({
  store,
  dir,
  today,
  theme,
  onThemeChange,
  onFileReady,
  onPickAnotherFolder,
}: {
  store: FileStore
  dir: { handle: FileSystemDirectoryHandle; key: string } | null
  today: string
  theme: ThemeChoice
  onThemeChange: (t: ThemeChoice) => void
  onFileReady: (handle: FileSystemDirectoryHandle, fileName: string, key: string) => void
  onPickAnotherFolder: () => void
}): JSX.Element {
  const { status, weekspan, mutate, mutateWithArchives, lastMerged, lastConflicts } =
    useWeekspan(store)

  const [zoom, setZoom] = useState(() => loadZoom())
  const fillWeeks = useFillWeeks(zoom)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; sel: Selection } | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [closeOutOpen, setCloseOutOpen] = useState(false)
  /** Which title is being edited in place, or which gap holds a new draft. */
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [view, setView] = useState<'priority' | 'project'>('priority')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string | null>>(new Set())
  // Colour of the unassigned bucket. Per-device, NOT in the ledger — see
  // `projects/noProjectColor.ts` for why the file deliberately does not carry it.
  const [noProjectColor, setNoProjectColor] = useState<string | null>(() => loadNoProjectColor())

  const [colorPicker, setColorPicker] = useState<{ projectId: string | null; x: number; y: number } | null>(
    null,
  )
  const [filterText, setFilterText] = useState('')
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeMessage | null>(null)
  const noticeId = useRef(0)

  const say = useCallback((text: string, tone: NoticeMessage['tone'] = 'info') => {
    noticeId.current += 1
    setNotice({ id: noticeId.current, text, tone })
  }, [])

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
    () => (weekspan ? buildGrid(weekspan, today, fillWeeks, noProjectColor) : null),
    [weekspan, today, fillWeeks, noProjectColor],
  )

  const projectNameById = useMemo(
    () => new Map((weekspan?.projects ?? []).map((p) => [p.id, p.name])),
    [weekspan],
  )

  /**
   * Filtering keeps a matching row's parent (or children) visible as context —
   * a sub-item floating with no parent above it is unreadable.
   */
  const filtered = useMemo(() => {
    if (!vm) return null
    const q = parseFilter(filterText)
    return filterRows(vm.rows, q, projectNameById)
  }, [vm, filterText, projectNameById])

  const filtering = filterText.trim() !== ''

  /**
   * Ids that survive the filter. Both views read this one set, so Priority and
   * Project view can never disagree about what matched.
   */
  const matchedIds = useMemo(
    () => (filtered ? new Set(filtered.map((r) => r.id)) : null),
    [filtered],
  )

  const projectVm = useMemo(
    () =>
      weekspan && view === 'project'
        ? buildProjectView(weekspan, today, {
            minWeeks: fillWeeks,
            collapsed,
            noProjectColorToken: noProjectColor,
          })
        : null,
    [weekspan, today, fillWeeks, view, collapsed, noProjectColor],
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

  /**
   * In Project view a drop means two things at once — which group the item now
   * belongs to, and where it sits in the single global rank spine. Neighbours are
   * read from the rows on screen, so what you see is what commits.
   */
  const handleProjectReorder = useCallback(
    (itemId: string, previewed: readonly ProjectRow[]): void => {
      // Neighbours come from the PREVIEWED rows — the list the user is looking
      // at — not from `projectVm.rows`. Reading the committed list here was the
      // bug: it always found the item at its existing position, so the drop
      // resolved to its own current group and neighbours and wrote nothing.
      const drop = dropFromRows(previewed, itemId)
      if (!drop) return
      void mutate((w) => applyProjectDrop(w, drop))
    },
    [mutate],
  )

  // Both hooks run every render (rules of hooks); only the active view's adapter
  // is ever handed a pointerdown, and the inactive one is null so it does no work.
  const priorityDrag = useDragPreview(
    useMemo(() => priorityAdapter(vm, handleReorder), [vm, handleReorder]),
  )
  const projectDrag = useDragPreview(
    useMemo(
      () => projectAdapter(projectVm?.rows ?? null, handleProjectReorder),
      [projectVm, handleProjectReorder],
    ),
  )
  const { state: dragState, gripHandlers } =
    view === 'project' ? projectDrag : priorityDrag

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
      // Enter on the ITEM column opens the title editor. The second Enter is
      // InlineEdit's own — it commits and clears `editing`, and because the
      // selection was never moved, the row drops straight back to selected.
      // `applyCycle` deliberately refuses this case rather than marking a cell.
      if (action.kind === 'cycle' && selection !== null && selection.date === null) {
        e.preventDefault()
        setEditing({ kind: 'existing', itemId: selection.itemId })
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
        <TopBar
          today={today}
          name={store.name}
          dir={dir}
          onFileReady={onFileReady}
          onPickAnotherFolder={onPickAnotherFolder}
          zoom={zoom}
          onZoom={setZoom}
          view={view}
          onView={setView}
          theme={theme}
          onThemeChange={onThemeChange}
          filterText={filterText}
          onFilterChange={setFilterText}
          matchCount={filtered?.length ?? 0}
          totalCount={vm.rows.length}
        />
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
            onCellMouse={(itemId, date, intent, x, y) => {
              // Left = select, right = cycle, left-double = menu; middle never
              // reaches here (see `intentForMouse`). Selection moves for every
              // path, so a cycle also leaves the cell selected for the keyboard
              // to take over. `cycle` goes through `applyAction` — the same
              // reducer Enter uses — so the vacation-day refusal cannot differ
              // between mouse and keyboard.
              const sel = selectionFromCell(itemId, date)
              setSelection(sel)
              if (intent.kind === 'select') return
              if (intent.kind === 'menu') {
                setMenu({ x, y, sel })
                return
              }
              const result = applyAction({ kind: intent.kind }, sel, weekspan, today)
              if (result.weekspan) void mutate(() => result.weekspan)
            }}
            onCloseOut={() => setCloseOutOpen(true)}
            onAddItem={() => setCaptureOpen(true)}
            onSortByDate={() => {
              void mutate((w) => {
                const sorted = sortByDate(w, today)
                // null means already in order — `mutate` writes nothing, so a
                // second press leaves no diff in a synced file.
                if (!sorted) {
                  say('Already sorted by date.')
                  return null
                }
                return sorted
              })
            }}
            gripHandlers={gripHandlers}
            previewRows={
              view === 'project'
                ? null
                : priorityDrag.state.draggingId
                  ? priorityDrag.state.rows
                  : filtering
                    ? (filtered ?? null)
                    : null
            }
            draggingId={dragState.draggingId}
            editingId={editing?.kind === 'existing' ? editing.itemId : null}
            draftSlot={editing?.kind === 'new' ? draftSlotKey(editing) : null}
            projectRows={
              view === 'project'
                ? // Mid-drag, render the prospective order — the same array the
                  // drop commits against, so what you see is what you get. A
                  // drag beats the filter: the rows you are moving between must
                  // stay put under the cursor.
                  (projectDrag.state.draggingId
                    ? (projectDrag.state.rows as ProjectRow[])
                    : filtering && projectVm && matchedIds
                      ? filterProjectRows(projectVm.rows, matchedIds)
                      : (projectVm?.rows ?? null))
                : null
            }
            onToggleGroup={(projectId) =>
              setCollapsed((cur) => {
                const next = new Set(cur)
                if (next.has(projectId)) next.delete(projectId)
                else next.add(projectId)
                return next
              })
            }
            onPickColor={(projectId, x, y) => setColorPicker({ projectId, x, y })}
            onToggleVacation={(date) => {
              void mutate((w) => {
                const result = toggleVacation(w, date, today)
                if (!result) return null
                // Rescheduling someone's work silently is the failure mode the
                // design warns about, so always say what moved.
                if (result.movedItemIds.length > 0) {
                  say(
                    `${result.movedItemIds.length} due date(s) moved off ${date} to the next working day.`,
                    'warn',
                  )
                }
                return result.weekspan
              })
            }}
            editingNotesId={editingNotesId}
            onStartEditNotes={(itemId) => setEditingNotesId(itemId)}
            onCommitNotes={(notes) => {
              const id = editingNotesId
              setEditingNotesId(null)
              if (!id) return
              void mutate((w) => commitNotes(w, id, notes))
            }}
            onStartEdit={(itemId) => setEditing({ kind: 'existing', itemId })}
            onInsertBetween={(afterId, beforeId, parentId, projectId) =>
              setEditing({
                kind: 'new',
                afterId,
                beforeId,
                parentId,
                // A seam inside a project group creates INTO that group. In
                // Priority view there is no group, so the field stays absent
                // and the item is created unassigned as before.
                ...(projectId !== undefined ? { projectId } : {}),
              })
            }
            onCancelEdit={() => setEditing(null)}
            onCommitEdit={(title) => {
              const target = editing
              setEditing(null)
              if (!target) return
              // Blanking an existing title deletes it. Destructive and
              // undoable only by retyping, so name what went rather than
              // letting a row vanish silently.
              if (target.kind === 'existing' && title.trim() === '') {
                const gone = itemsRemovedBy(weekspan, target.itemId)
                if (gone.length > 0) {
                  const extra = gone.length > 1 ? ` and ${gone.length - 1} sub-item(s)` : ''
                  say(`Deleted ${JSON.stringify(gone[0]!.title)}${extra}.`, 'warn')
                }
              }
              // commitEdit returns null for an unchanged title or an abandoned
              // draft, and `mutate` treats null as "write nothing".
              void mutate((w) => commitEdit(w, target, title))
            }}
          />
        </div>
        <ShortcutBar count={vm.rows.length} />
      </div>

      {menu && menu.sel.date !== null ? (
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
          onSubmitBulk={(parse, position) => {
            void mutate((w) => commitBulk(w, parse, position, today))
            setCaptureOpen(false)
            say(`Imported ${parse.createCount} item(s).`)
          }}
          onSubmit={(capture, position, mode) => {
            if (mode === 'project') {
              void mutate((w) => commitProjectCapture(w, capture.title))
              setCaptureOpen(false)
              return
            }
            void mutate((w) => {
              try {
                return insertItem(w, {
                  title: capture.title,
                  // An empty weekspan has no anchor at all; omit rather than pass
                  // undefined, which exactOptionalPropertyTypes rejects.
                  ...captureAnchor(w, today, position),
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

      <Notice message={notice} onDismiss={() => setNotice(null)} />

      {colorPicker ? (
        <ProjectColorPicker
          value={
            colorPicker.projectId === null
              ? noProjectColor
              : (weekspan.projects.find((p) => p.id === colorPicker.projectId)?.colorToken ?? 'barA')
          }
          allowNone={colorPicker.projectId === null}
          onChange={(token) => {
            if (colorPicker.projectId === null) {
              // Local preference, so this is a setState + localStorage write and
              // never touches the file — no diff, nothing to merge.
              saveNoProjectColor(token)
              setNoProjectColor(token)
            } else if (token !== null) {
              void mutate((w) => setProjectColor(w, colorPicker.projectId as string, token))
            }
            setColorPicker(null)
          }}
          onClose={() => setColorPicker(null)}
          position={{ x: colorPicker.x, y: colorPicker.y }}
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
  dir,
  onFileReady,
  onPickAnotherFolder,
  zoom,
  onZoom,
  view,
  onView,
  theme,
  onThemeChange,
  filterText,
  onFilterChange,
  matchCount,
  totalCount,
}: {
  today: string
  name: string
  dir: { handle: FileSystemDirectoryHandle; key: string } | null
  onFileReady: (handle: FileSystemDirectoryHandle, fileName: string, key: string) => void
  onPickAnotherFolder: () => void
  zoom: number
  onZoom: (z: number) => void
  view: 'priority' | 'project'
  onView: (v: 'priority' | 'project') => void
  theme: ThemeChoice
  onThemeChange: (t: ThemeChoice) => void
  filterText: string
  onFilterChange: (v: string) => void
  matchCount: number
  totalCount: number
}): JSX.Element {
  const label = new Date(`${today}T00:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '')
  return (
    <div className="ws-topbar">
      <LedgerMenu
        name={name}
        dir={dir}
        onOpen={onFileReady}
        onPickAnotherFolder={onPickAnotherFolder}
      />
      {/* One group, two segments. `aria-pressed` is what tells a screen reader
          which view is current — the pill styling alone says nothing. */}
      <div className="ws-seggroup" role="group" aria-label="View">
        <button
          className={`ws-seg${view === 'priority' ? ' ws-seg--active' : ''}`}
          type="button"
          aria-pressed={view === 'priority'}
          onClick={() => onView('priority')}
        >
          Priority
        </button>
        <button
          className={`ws-seg${view === 'project' ? ' ws-seg--active' : ''}`}
          type="button"
          aria-pressed={view === 'project'}
          onClick={() => onView('project')}
        >
          Project
        </button>
      </div>
      <FilterField
        value={filterText}
        onChange={onFilterChange}
        matchCount={matchCount}
        totalCount={totalCount}
      />
      <span className="ws-topbar-spacer" />
      <ZoomPicker zoom={zoom} onZoom={onZoom} />
      <ThemePicker value={theme} onChange={onThemeChange} />
      <span className="ws-date">{label}</span>
      <span className="ws-week">{weekOf(today)}</span>
    </div>
  )
}
