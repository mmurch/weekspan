# Architecture Decisions — Personal TODO Ledger

Working record of decisions made before implementation. Supersedes the handoff spec
(`design_handoff_todo_ledger/README.md`) where the two conflict — conflicts are noted inline.

## Platform & distribution

**Browser web app, Chrome/Edge only**, using the File System Access API.

Rejected Tauri/Electron. Tauri is genuinely lightweight (system webview, single-digit MB, no admin
needed for `~/Applications`), but macOS Gatekeeper makes distribution expensive: unsigned apps are
blocked behind System Settings, and avoiding that means an Apple Developer account, code signing,
and notarization on every build, plus signing keys and a hosted manifest for auto-update. That's a
permanent pipeline for something that should be a URL.

Accepted constraints: no Safari or Firefox; a one-click directory permission re-grant per session;
must be served over HTTPS or localhost. Native file watching is lost, but polling
`FileSystemFileHandle` → `file.lastModified` is cheap and only parses when the timestamp moves.
(That is fine for *noticing* a change; it is not sufficient for write safety — see "Agent access".)

## Source of truth & sync

**The ledger file is truth.** No server, no backend, no accounts, no auth.

Sync is delegated to whatever file-sync the user already runs. On desktop this needs *zero*
provider integration: `~/Google Drive/work.ledger.json` and `~/Dropbox/personal.ledger.json` are
both just paths, and the provider's desktop client syncs them invisibly. One local-filesystem
adapter covers every provider. A client mounts N ledger paths; the work machine can mount work +
personal while the home machine mounts personal only.

Provider-specific code becomes necessary only on mobile, where no locally synced folder exists.

**Conflicts:** the client parses the file into a real data structure, so it can do a semantic
three-way merge — base is what we last read, "ours" is memory, "theirs" is what's now on disk.
Re-read and compare CONTENT before every write, then merge rather than clobber. (Not
`lastModified` — filesystem mtime granularity is often 1 second, so same-second writes are
indistinguishable. See "Agent access".) Item-level merges essentially always succeed.

## Storage layout

**One working file + an `archive/` folder** (one file per closed-out week).

Rejected the handoff's "one file per ISO week." Items are rows and days are columns; per-week files
slice by column, which is orthogonal to the entity. An undated item has no week to live in, setting
a due date would migrate an item between files, and rank is a single global total order that
becomes undefined across file boundaries. The four-week window is a *view* computed from due dates,
not a storage boundary. Close-out is the only real storage boundary, since archived items leave the
working set permanently.

Close-out keeps the working file drained — realistically tens to low hundreds of items.

## Format

**JSON.** Deterministic pretty-print, stable key order, items sorted by rank.

The handoff's "plain-text-first so an agent can edit it" assumes agents prefer markdown. They don't
— LLMs write JSON at least as reliably, since there's one way to express a value. The beneficiary
of markdown is a human reading a diff. With the file as truth, markdown is a presentation format
doing a serialization job: parsers must tolerate variants, and every tolerated variant is a place
where round-trip silently normalizes or loses data. Machine fields (`id`, `rank`, marks map,
recurrence rule) also don't belong in prose.

The 1d file-mirror panel can still render an editable **markdown projection inside the app** — the
round-trip risk is bounded there, since the client generates and reparses in one step.

File header carries `$schema`, an integer `version` for migrations, and
`"$agent": "Do not hand-edit; run npx ledger --help or see ./AGENTS.md"`.

The `version` integer matters: an old tab can meet a file written by a newer client and must refuse
rather than silently drop fields.

**v1 parsing is strict.** See Deferred.

## Data model

Supersedes the handoff, which specified at most one due date and one `done_on` per item. Note the
design half-anticipated this already — 3a lists "multi-cell drag moves a whole row's schedule,"
which only makes sense if a row owns several cells.

### Marks

Replaces the `due` / `done_on` scalars. Each item owns a sparse map keyed by date:

```json
"marks": {
  "2026-08-25": { "kind": "done" },
  "2026-08-27": { "kind": "due" },
  "2026-09-01": { "kind": "skip", "provenance": "deliberate" }
}
```

A mark is an object, not a bare string, because skips carry provenance (see Auto-close).
`Mark` is a discriminated union, so `provenance` is **required** on a skip and forbidden on
anything else — a skip without it is rejected at parse rather than defaulted, since there is
no honest default between "deliberate" and "auto".

One mark per (item, date), matching the cell menu's mutually-exclusive Mark done / Set due / Clear.
Chunking work across sessions is just several marks.

Known loss: marking a planned day done overwrites its due, so "was this done on a day I'd planned?"
is not answerable. Accepted — it's what the sheet does.

### Finished state — derived, never stored

- **Non-recurring:** finished when the **latest non-skip mark is `done`**.
- **Recurring:** never finished, therefore never archived.

Skips are transparent to the derivation, or skipping one chunk would drag an otherwise-complete item
back to unfinished.

Rejected an explicit `status` field: no second place to mark something done.

This rule handles missed-then-completed correctly (planned Tue, lapsed, done Thu → finished, with
the lapsed Tuesday DUE still visible in the past, which is honest).

### Recurring items

Weekly / every-other-week / monthly. **Store the rule; generate occurrences for the visible window
at render time; persist only exceptions** (done, skip, one-off reschedule). A weekly task stays one
line in the ledger forever, and an agent reads `every 2 weeks on Mon` rather than fifty dates.

A cell renders as due if there's an explicit due mark *or* the rule generates an occurrence there;
any explicit mark overrides the generated one.

**Display:** a recurring item *appears* finished when the occurrence in the current **period** has a
`done` mark — period being the rule's own (week / fortnight / month), not the calendar week. A
monthly item done on the 3rd reads as done for the rest of that month. Because appearance depends on
today's date, a long-lived tab needs a day-rollover tick to re-render.

### Rank

String fractional indexing (base62 keys), not floats. Never needs a rebalance — which matters
because a global renumber would rewrite every row in a synced, diffable file.

Scoped to siblings for nesting: global order = walk roots by rank, then each root's children by
rank. Avoids the invariant that a parent's children must stay contiguous in a single global spine.

**Project-view drag — minimal move.** Dropping X between A and B (both in project P) constrains X
only to sort between them; the interval may contain many items from other projects and we don't care
which one X lands beside.

- If X's current rank already sits in that interval → **no write at all**.
- Otherwise move X just past the boundary it violated — immediately below A, or immediately above B,
  in global order.

Drags move an item as far as they must and no farther, so they converge instead of drifting and each
touches one line. Accepted consequence: a project drag can be a visible no-op in Priority view, and
dragging to the top of a project only lifts an item above that project's current top item, which may
itself be buried globally.

### Close-out

> A past week is closeable when every due mark in it — explicit **or** generated — is resolved:
> done, skipped, or cleared.

A recurring occurrence *inside the closing week* blocks; occurrences in future weeks do not. This
forces every lapse to become a deliberate SKIP, which is the point — it makes skip data complete
without materializing anything, and it makes you look at the thing and declare.

**Archive criterion:** archive an item only if it is finished **and** its latest mark falls on or
before the closing week's end. Without the second clause, closing W35 could rip out an item that
still has live cells in W36.

**Sequential.** You close the oldest outstanding week; you cannot close W34 while W33 is open. That
lets a single `closedThrough: "2026-W34"` pointer in the ledger replace a set of closed weeks, and
means only one week ever shows the `×`. (The handoff implies several weeks could show it at once.)

### The window

**Pinned, not scrollable.** The left edge is the oldest week that hasn't been closed out; the right
edge is the current week + 2. When you're caught up that's exactly the four blocks the design draws
— last week dimmed, this week, two ahead.

No back-navigation in v1. Looking at old items is rare enough to be a later feature, and the archive
files are readable by hand or by an agent in the meantime.

**Variable width when behind.** Leave a ledger alone for three weeks and the window grows leftward
to cover the outstanding weeks, then shrinks back to four as you close them. The grid nags with real
backlog instead of hiding it. Six blocks is ~1,740px including the item column, so the grid needs to
scroll horizontally — worth knowing before laying it out.

**Auto-close.** A past week closes silently on load if it holds nothing but unresolved recurring
occurrences, which are auto-marked `skip`. No confirmation, no toll booth.

> **Principle: returning to a neglected ledger must never cost more than a glance.** Switch tools for
> three months, come back, and the grid should be usable immediately — never a few dozen mandatory
> clicks. This overrides the forcing function below.

This deliberately weakens the close-out gate that was meant to make you confront skips. Accepted:
recurring occurrences generate every week whether you're present or not, so blocking on them
punishes absence rather than avoidance. Skips therefore record **provenance** — deliberate vs.
auto — so a skip-streak feature can count only the ones you were actually present for. Without that
flag, three months away would write a dozen auto-skips and drown the signal skip exists to surface.

**Explicit dues still block** (confirmed). A past week holding a real, un-done, non-recurring DUE
does not auto-close — that's genuine backlog and you should see it. Long absences can therefore
still leave several blocked weeks and a wide window; a bulk triage affordance is deferred.

### Skipped rows

Skipped items render the way the web renders **disabled**: italicized and de-emphasized, **not**
struck through. Strikethrough is reserved for completion — conflating "I didn't do this" with "I
finished this" is exactly the wrong signal on a habit you're trying to break.

## Agent access

Agents should never hand-edit the file. The invariants (fractional rank, derived finished state,
generated-not-materialized occurrences, one mark per cell) are exactly the kind of thing that gets
subtly wrong and corrupts quietly.

**`ledger-core`** — pure TypeScript. Parse, serialize, and every mutation, with all invariants
enforced. No I/O. Consumed by:

- **the browser app** — File System Access API for I/O
- **a CLI** — `ledger add "call the plumber" --due thu`, `ledger done <id>`,
  `ledger close-out`. Node `fs`. This is what agents use. **Built** — see
  `packages/cli`.

MCP is deferred. The CLI is the substrate either way, and an MCP server would be a thin stdio
wrapper over the same core — cheap to add once the agent flows are actually known.

The CLI also gives safe concurrent writes: atomic read-modify-write (temp file + fsync + rename)
plus a staleness check before every write. A hand-editing agent gets neither.

Note the staleness check compares file CONTENT, not `lastModified` as originally planned — many
filesystems report mtime at 1-second granularity, so two writes inside the same second are
indistinguishable by `stat`. The browser client should do the same rather than trusting
`file.lastModified`.

**Discovery** uses three complementary mechanisms, none individually reliable:

1. `CLAUDE.md` + `AGENTS.md` in the ledger folder — picked up automatically by agents pointed at it.
2. A skill (folder-level `.claude/skills/` or user-level) that **bundles the CLI**, so it ships the
   tool rather than only describing it. Loads on demand rather than always occupying context.
3. The self-describing file header, for when an agent meets the file with no folder context.

These are conventions, not enforcement. The only structural protection is that the sanctioned path
is easier than hand-editing, and the file is loud about it.

## Deferred

- **Local MCP server.** A thin stdio wrapper over `ledger-core`, exposing the tools 1d already
  names: `list_items`, `add_item`, `complete_item`, `reschedule`, `close_out_week`. Deferred because
  ~90% of edits will happen in the browser UI and the agent flows aren't known yet — building the
  tool surface before the flows would be guessing. v1 agent access is `CLAUDE.md` + `AGENTS.md` +
  a skill wrapping the CLI.
- **Tolerant / repairing reader.** v1 is strict. Later: on load, generate missing `id`s, re-derive
  broken or duplicate rank keys, preserve unknown fields rather than dropping them, and report what
  was repaired. The difference between "an agent mangled it, I lost an afternoon" and "it fixed four
  things and told me."
- **Mobile client.** Needs per-provider API adapters (Drive/Dropbox), since a phone has no locally
  synced folder. Separate problem from the desktop shell — would have been separate under Tauri too.
- **Multi-user.** Under file-as-truth this is just a shared sync folder, so the door stays open at no
  schema cost. Open question if it happens: whether a shared ledger has one agreed rank or per-user
  ordering.
- **SKIP chip** — the cell-level mark is still undrawn. The *row* treatment is decided (below).
- **Skip-streak surfacing** ("skipped 3 weeks running") — the reason skip exists. Must count only
  deliberate skips, using the provenance flag.
- **Bulk triage for long absences.** Explicit dues still block auto-close, so returning after months
  can leave several blocked weeks at once. Reschedule-or-drop-all would keep that within the
  glance-cost principle.
- **Adherence tracking** — currently unanswerable by design, see Marks.

## Settled during implementation

- **Mounted-ledger list lives in IndexedDB, per-device**, alongside the theme choice — never in
  the ledger file. It is a property of *this machine*, which is what lets the work laptop mount
  two ledgers and the home machine mount one without the two fighting over file contents.
- **Stack:** React + TypeScript; CSS custom properties for the token set, since
  `Grid Theme.dc.html` is already a clean token contract; fine-grained state for cell selection
  so an arrow keypress does not re-render the whole grid.
- **Monorepo** (`packages/ledger-core`, later `packages/cli` and `apps/web`), since three
  consumers of one core is the whole architecture.

## Still open

- Grid rendering is the real remaining engineering risk — wrapping rows that must stay
  column-aligned across the whole table wants ONE CSS Grid with rows as `display: contents`,
  not nested flexbox per row. Not yet built or proven.
- The SKIP cell chip is still undrawn (the row treatment is decided: italic, de-emphasized,
  never struck through).
- Schema migration tooling does not exist yet. `MIGRATIONS.md` holds the version contract
  and a checklist to work through before `SCHEMA_VERSION` is ever bumped.
