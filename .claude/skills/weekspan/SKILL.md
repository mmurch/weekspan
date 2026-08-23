---
name: weekspan
description: Read and modify a Weekspan task file (a *.weekspan.json file holding a rolling multi-week grid of tasks, due dates, completions and recurring items). Use whenever asked to add, complete, schedule, skip, reorder, list, or close out tasks, or when working in a folder containing a *.weekspan.json file. Never hand-edit the JSON — this skill wraps the CLI that enforces its invariants.
---

# Weekspan

A personal task grid: one row per task, one column per calendar day. Cells hold a `DUE`
marker, a completion, or a skip. Backed by a single JSON file that syncs between devices.

## Always use the CLI

The file has invariants that are not visible in its shape, and violating them corrupts it
quietly. Never write the JSON directly.

```bash
weekspan status                      # start here
weekspan list --json                 # machine-readable
weekspan add "call the plumber" --due thu
weekspan done <id>                   # defaults to today
weekspan due  <id> 2026-08-27
weekspan skip <id>                   # deliberate skip
weekspan clear <id>
weekspan move <id> --before <other>
weekspan close-out [--auto]
```

Target a specific file with `--weekspan <path>` or `WEEKSPAN_FILE`. Dates accept `2026-08-27`,
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
- **`rank` is a fractional index.** Reorder with `weekspan move`, never by editing the value.
- **Prefer ids over titles.** An ambiguous title errors rather than guessing, which is the
  safe behaviour but costs a round trip.

## Close-out

A past week closes only when every due in it — explicit or recurring — is resolved.
`weekspan status` names what is blocking and whether each blocker needs completing (explicit)
or skipping (recurring). `weekspan close-out --auto` catches up after a long absence in one
step, auto-skipping lapsed recurring occurrences.
