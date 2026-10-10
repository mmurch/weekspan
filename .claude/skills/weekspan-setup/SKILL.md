---
name: weekspan-setup
description: Set up the Weekspan repo on a new machine — install, build, verify, and hand the user a working app and CLI. Use when someone has just cloned or copied this repo onto a machine and wants it running, says "set this up", "get this working here", or asks how to use it on a new laptop.
---

# Weekspan — set up on a new machine

Get from "the repo is on disk" to "the app opens and the CLI runs". Takes about two minutes.

## First: does this person actually need the repo?

Ask before installing anything. **Using** weekspan needs no repo, no Node, and no install.

If they just want to run the app on this machine, the answer is not this skill — it is the
release zip, which carries its own installer:

```bash
unzip weekspan-*.zip && cd weekspan-*/ && ./install.sh
```

That installs to `~/weekspan/`, leaves any existing `~/weekspan/ledger/` untouched, and is safe
to re-run for every future update. They build the zip with `npm run release` on the machine that
HAS the repo. Point them there and stop.

Run the rest of this only if they want to change the code or build releases here.

## 1. Check Node

```bash
node -v
```

Needs **18 or newer** (the CLI targets node18; the build uses Vite 5). If it's older or
missing, stop and say so rather than installing a runtime on someone's machine uninvited —
suggest `nvm install 18` or a system package and let them choose.

## 2. Install

```bash
npm install
```

Run it from the repo root, not from a package — this is an npm workspaces monorepo
(`packages/*`, `apps/*`) and installing from a subdirectory silently gets the wrong tree.

## 3. Verify before declaring victory

```bash
npm run verify
```

This is the real check: typecheck, ~1000 tests across three packages, the single-file build,
and two Playwright probes that drive the built app in a real browser. It takes under a minute.

If the Playwright probes fail with a missing-browser error, the download was skipped:

```bash
npx playwright install chromium
```

Report the actual failure if anything else breaks. Do not paper over a red verify — a fresh
clone that does not pass is information the user needs, not noise to suppress.

## 4. Build a release

```bash
npm run release
```

Produces `dist-release/weekspan-<build>.zip` — the app, the CLI, the sidecars `init` needs, and
`install.sh`. That zip is the unit of distribution: send it anywhere, unzip, run `./install.sh`.

The build stamp (date + short SHA) goes into the zip name, the `VERSION` file, and the app's
own footer, so all three agree about which build is which.

## 5. Hand it over

**The app.** Run the installer from the release they just built:

```bash
cd dist-release/weekspan-*/ && ./install.sh
```

Then open `~/weekspan/weekspan.html` in **Chrome or Edge**. Not Firefox, not Safari — the app
writes the ledger through the File System Access API, which only Chromium browsers implement.

Installing rather than opening the file in place matters: the browser ties its remembered file
permission to a location, and `dist-release/` is wiped on every build.

**The CLI.** The installer put it beside the app. Either run it directly, or link the
workspace package for a `weekspan` command on PATH:

```bash
node ~/weekspan/weekspan-cli.mjs status --weekspan ~/weekspan/ledger/personal.weekspan.json
# or:
npm run build -w @weekspan/cli && npm link -w @weekspan/cli
```

**A ledger to point at.** `install.sh` creates `~/weekspan/ledger/personal.weekspan.json` on a
first install when Node is present. To make another one:

```bash
node ~/weekspan/weekspan-cli.mjs init --weekspan ~/weekspan/ledger/work.weekspan.json
```

`init` also writes `AGENTS.md`, `CLAUDE.md` and `weekspan.schema.json` beside the file, so any
agent pointed at that folder learns the rules without being told.

Set `WEEKSPAN_FILE` in their shell profile so neither client needs `--weekspan` every time.

## Moving an existing ledger here

The ledger is a single `.weekspan.json` file — copy it over like any other file. Both clients
read and write the same format, so a file written on one machine opens on the other.

**Say this out loud, because it is the sharp edge:** there is no sync. Two machines editing
their own copy of a ledger will diverge, and reconciling them means a merge, not a copy. The
repo has a real three-way merge (`packages/weekspan-core/src/merge.ts`) that resolves at item
and cell granularity, but nothing runs it automatically across machines. If they want one
ledger in two places, ask what their sync story is before they start relying on it — see
`docs/google-drive-sync.md`.

## When it doesn't work

- **`npm install` fails on workspaces** — they're in a subdirectory. `cd` to the repo root.
- **Playwright probes fail** — `npx playwright install chromium`.
- **App opens but shows nothing** — check the browser. Firefox/Safari render the shell and
  then cannot open a file. The console says so.
- **App can't reopen the last file** — expected after moving either the HTML or the ledger.
  Re-pick the file.
- **An update doesn't seem to have applied** — check the build stamp in the app's footer
  against `cat ~/weekspan/VERSION`. If they disagree, the open tab is stale; hard-reload it.
- **An update broke something** — `./install.sh --rollback` from the unzipped folder restores
  the previous build. The ledger is untouched either way.
- **Fonts look wrong** — the page pulls IBM Plex from `fonts.googleapis.com`. A proxy blocking
  it costs the typeface and nothing else; the app is fully functional on system fonts.
