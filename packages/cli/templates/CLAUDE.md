# TODO ledger

See [AGENTS.md](./AGENTS.md) in this folder for how to read and modify the ledger.

Short version: `*.ledger.json` is structured data with non-obvious invariants. Do not hand-edit
it — use the `ledger` CLI. Run `ledger status` to orient, and add `--json` to any command for
machine-readable output.
