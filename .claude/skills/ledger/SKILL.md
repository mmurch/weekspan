---
name: ledger
description: Read and modify a personal TODO ledger (a *.ledger.json file with a rolling multi-week grid of tasks, due dates, completions and recurring items). Use whenever asked to add, complete, schedule, skip, reorder, list, or close out tasks in a ledger, or when working in a folder containing a *.ledger.json file. Never hand-edit the JSON — this skill wraps the CLI that enforces its invariants.
---

# Ledger

A personal task ledger: one row per task, one column per calendar day. Cells hold a `DUE`
marker, a completion, or a skip. Backed by a single JSON file that syncs between devices.

## Always use the CLI

The file has invariants that are not visible in its shape, and violating them corrupts it
quietly. Never write the JSON directly.

```bash
ledger status                      # start here
ledger list --json                 # machine-readable
ledger add "call the plumber" --due thu
ledger done <id>                   # defaults to today
ledger due  <id> 2026-08-27
ledger skip <id>                   # deliberate skip
ledger clear <id>
ledger move <id> --before <other>
ledger close-out [--auto]
```

Target a specific file with `--ledger <path>` or `LEDGER_FILE`. Dates accept `2026-08-27`,
`thu`, `today`, `tomorrow`, `+3d`, `-1w`.

## Output contract

`--json` gives `{"ok": true, "data": {...}}` or
`{"ok": false, "error": {"code": N, "message": "..."}}`.
Exit codes: `0` ok · `2` bad input · `3` refused (domain rule) · `4` file problem.

## Rules that are easy to get wrong

- **Finished is derived, not stored.** An item is finished when its latest non-skip mark is
  `done`. There is no status field to set.
- **Recurring items store a rule, not dates.** Their `marks` map is empty until an occurrence
  is completed or skipped. Never write generated occurrences.
- **Skips carry provenance.** The CLI writes `deliberate`; only `close-out --auto` writes
  `auto`. The distinction is what separates avoidance from absence.
- **`rank` is a fractional index.** Reorder with `ledger move`, never by editing the value.
- **Prefer ids over titles.** An ambiguous title errors rather than guessing, which is the
  safe behaviour but costs a round trip.

## Close-out

A past week closes only when every due in it — explicit or recurring — is resolved.
`ledger status` names what is blocking and whether each blocker needs completing (explicit)
or skipping (recurring). `ledger close-out --auto` catches up after a long absence in one
step, auto-skipping lapsed recurring occurrences.
