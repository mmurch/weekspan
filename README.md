# Weekspan

A personal task grid that replaces a Google Sheet. One row per task, one column per calendar
day; a cell is a completion, a `DUE` marker, or a skip.

No server, no accounts. The file is plain JSON in a folder you already sync (Drive, Dropbox,
iCloud), so multi-device works without a backend and agents can edit it through a CLI.

## Layout

| Path | What it is |
|---|---|
| `packages/weekspan-core` | All domain logic. Pure — no I/O, no clock. 232 tests. |
| `packages/cli` | `weekspan` command. The sanctioned write path for agents. 176 tests. |
| `design_handoff_todo_ledger/` | Original design handoff (mockups, screenshots, spec). Retains its original naming as a received artifact — it predates the Weekspan name. |
| `ARCHITECTURE.md` | Every design decision and why. Supersedes the handoff where they conflict. |
| `IMPLEMENTATION-NOTES.md` | Decisions made while building, plus every bug found and how. |
| `MIGRATIONS.md` | The schema version contract. Read before bumping `SCHEMA_VERSION`. |

## Getting started

```bash
npm install
npm test          # all packages
npm run typecheck # must be clean; a green test run does not imply this
npm run verify    # the above PLUS the single-file build, opened over file://
```

## How to iterate

Two environments, and the difference between them is packaging, not behaviour.

**`npm run dev -w @weekspan/web`** for feature work. `http://localhost` is a secure
context, so the File System Access API behaves exactly as it does from a file — anything
you build here works there. Hot reload makes this the only sane place to iterate on UI.

**`npm run verify`** before committing. The shipping artifact is a single self-contained
HTML file opened over `file://`, where three things differ from the dev server: the bundle
is a classic IIFE rather than an ES module, JS and CSS are inlined rather than linked, and
CORS blocks every external fetch. Every packaging bug this project has hit lived in exactly
that gap and passed all tests — an inliner that spliced HTML into the bundle, a script that
ran before `#root` existed, and a second Vite entry that silently broke the build. So the
check has to be routine, not remembered.

**To actually use it day to day**, build the single file and open that rather than the dev
server:

```bash
npm run build:single -w @weekspan/web   # → apps/web/dist-single/weekspan.html
```

It keeps working while development continues, and it is the same artifact you would hand
to someone else.

Build and use the CLI:

```bash
cd packages/cli && npm run build
node dist/index.js init --weekspan ~/todo/personal.weekspan.json
node dist/index.js add "choose stick-on tiles" --due thu
node dist/index.js status
```

`weekspan init` also writes `AGENTS.md`, `CLAUDE.md`, and `weekspan.schema.json` beside the file,
so any agent pointed at that folder learns the rules without being told.

## Core ideas

- **The file is truth.** No server. Conflicts resolve through a semantic three-way merge at
  item and cell granularity, not last-writer-wins on the whole file.
- **Finished state is derived, never stored.** An item is finished when its latest non-skip
  mark is `done`. There is no status field to get out of sync.
- **Recurring items store a rule, not dates.** Occurrences are generated at read time; only
  exceptions (a completion, a skip) are ever written.
- **Rank is a fractional index.** Reordering touches one line, so a drag does not rewrite a
  synced file.
- **Skips carry provenance.** `deliberate` is a choice; `auto` is catch-up after an absence.
  Conflating them would destroy the signal the field exists for.

## Status

`weekspan-core` and the CLI are complete and tested. The web app is not built — the grid is the
main remaining engineering risk (wrapping rows that stay column-aligned across the whole table).
