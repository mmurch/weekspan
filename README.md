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

## Moving it to another machine

The web app builds to **one self-contained HTML file**. Nothing to install on the receiving
machine — no Node, no repo, no server. The repo is a prerequisite for *changing* weekspan, not
for *using* it.

### The loop

Three steps, and each one prints the next.

**1. Here — build the zip:**

```bash
npm run release
```

→ `dist-release/weekspan-2026-08-25-a94c87b.zip` (~108KB). Named for its build stamp.

**2. Slack or email it to yourself.**

**3. There — unzip and run the installer that came with it:**

```bash
unzip weekspan-*.zip && cd weekspan-*/ && ./install.sh
```

→ installs to `~/weekspan/`. Open `~/weekspan/weekspan.html` in **Chrome or Edge** (Firefox and
Safari can't write the ledger — no File System Access API).

That's it. Repeat all three whenever you want to push an update; nothing differs on the second
run or the fiftieth.

### What makes it safe to repeat

- **Your ledger is never touched.** The installer owns a fixed list of app files and writes
  only those. `~/weekspan/ledger/` — and anything else you put there — is left alone. There is
  no `rm -rf` of the destination anywhere in the script, deliberately.
- **The build stamp is in the app's footer**, bottom right, matching the zip name and
  `~/weekspan/VERSION`. After an update, glance at it to confirm the new build actually landed —
  otherwise two builds look identical and you're guessing.
- **One version back is kept.** If an update breaks something: `./install.sh --rollback`.
- **The installer ships inside the zip**, so there's nothing to have already installed and
  nothing to remember on the other machine.

Install somewhere else with `WEEKSPAN_HOME=/some/path ./install.sh`.

### The CLI

The zip includes it. Needs Node 18+; the app itself needs nothing.

```bash
node ~/weekspan/weekspan-cli.mjs status --weekspan ~/weekspan/ledger/personal.weekspan.json
```

Set `WEEKSPAN_FILE` in your shell profile to drop the flag. The installer creates a starter
ledger on first install if Node is available and you don't already have one.

### Developing on the other machine

Only if you want to change the code. Copy the repo over and ask Claude or Cursor to run the
**`weekspan-setup`** skill (`.claude/skills/weekspan-setup/`) — it checks Node, installs, runs
the full verify, and builds a release.

### There is no sync

The ledger is a file; two machines editing their own copy will diverge. `weekspan-core` has a
real three-way merge, but nothing runs it across machines automatically. Keep a separate ledger
per machine unless you have deliberately set up sync — see
[docs/google-drive-sync.md](docs/google-drive-sync.md).

## Status

`weekspan-core`, the CLI and the web app are complete and tested — around 1,000 tests plus two
Playwright probes that drive the built app in a real browser (`npm run verify`).
