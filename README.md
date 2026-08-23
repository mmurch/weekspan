# murch-todo

A personal task ledger that replaces a Google Sheet. One row per task, one column per calendar
day; a cell is a completion, a `DUE` marker, or a skip.

No server, no accounts. The ledger is a JSON file in a folder you already sync (Drive, Dropbox,
iCloud), so multi-device works without a backend and agents can edit it through a CLI.

## Layout

| Path | What it is |
|---|---|
| `packages/ledger-core` | All domain logic. Pure — no I/O, no clock. 232 tests. |
| `packages/cli` | `ledger` command. The sanctioned write path for agents. 176 tests. |
| `design_handoff_todo_ledger/` | Original design handoff (mockups, screenshots, spec). |
| `ARCHITECTURE.md` | Every design decision and why. Supersedes the handoff where they conflict. |
| `IMPLEMENTATION-NOTES.md` | Decisions made while building, plus every bug found and how. |
| `MIGRATIONS.md` | The schema version contract. Read before bumping `SCHEMA_VERSION`. |

## Getting started

```bash
npm install
npm test          # all packages
npm run typecheck # must be clean; a green test run does not imply this
```

Build and use the CLI:

```bash
cd packages/cli && npm run build
node dist/index.js init --ledger ~/todo/personal.ledger.json
node dist/index.js add "choose stick-on tiles" --due thu
node dist/index.js status
```

`ledger init` also writes `AGENTS.md`, `CLAUDE.md`, and `ledger.schema.json` beside the ledger,
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

`ledger-core` and the CLI are complete and tested. The web app is not built — the grid is the
main remaining engineering risk (wrapping rows that stay column-aligned across the whole table).
