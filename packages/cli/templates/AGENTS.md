# This folder holds a TODO ledger

`*.ledger.json` is a structured task ledger. **Do not hand-edit it.** Use the `ledger` CLI —
it enforces invariants that are not obvious from the file's shape, and getting them wrong
corrupts the ledger quietly rather than loudly.

## Commands

```
ledger status                      # start here: window, counts, what blocks close-out
ledger list [--project <id>] [--open|--done] [--week <YYYY-Www>]
ledger add "<title>" [--due <date>] [--project <id>] [--parent <item>]
ledger done <item> [date]          # date defaults to today
ledger due  <item> <date>
ledger skip <item> [date]
ledger clear <item> [date]
ledger move <item> --before|--after <other>
ledger edit <item> [--title ...] [--notes ...]
ledger rm   <item> --force
ledger close-out [--auto]
```

Add `--json` to any command for machine-readable output:
`{"ok": true, "data": {...}}` or `{"ok": false, "error": {"code": N, "message": "..."}}`.
Exit codes: `0` ok, `2` bad input, `3` refused for a domain reason, `4` file problem.

Dates accept `2026-08-27`, `thu`, `today`, `tomorrow`, `+3d`, `-1w`.

Point at a specific ledger with `--ledger <path>` or `LEDGER_FILE`.

## Why not to edit the JSON directly

- **`rank` is a fractional index**, not a position. Renumbering, reusing, or inventing a key
  breaks ordering permanently. Use `ledger move`.
- **Finished state is derived, never stored.** There is no `done` field. An item is finished
  when its latest non-skip mark is `done`. Writing a status field does nothing.
- **Recurring occurrences are generated, never stored.** A weekly item has a rule and an empty
  `marks` map. Writing out the generated dates makes the file grow without bound and turns
  every occurrence into a permanent exception.
- **`marks` is one mark per date.** Setting a mark replaces whatever was there.
- **A `skip` must carry `provenance`.** `deliberate` means a person chose to skip;
  `auto` is written only by `close-out --auto` during catch-up. Mislabelling these destroys
  the distinction between "avoided this" and "was away".
- Writes must be **atomic and merge-aware**. This file syncs across devices; a naive
  read-modify-write can silently discard an edit made elsewhere. The CLI handles this.

## Prefer ids

`ledger done <id>` is unambiguous. Title matching is a human convenience; an ambiguous title
is an error listing candidates, never a guess.
