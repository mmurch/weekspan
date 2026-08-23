# Implementation Notes — `ledger-core`

Decisions made *during* the build that go beyond `ARCHITECTURE.md`, plus the judgment
calls each module author flagged for review. Read this alongside the architecture doc;
this file is the "second-guess me here" list.

## Review pass — outcomes

Every flagged decision below was walked through and ruled on. Recorded here so the
"flagged for review" markers further down are not mistaken for still-open questions.

**Changed as a result:**
- `Mark` → discriminated union (done; see below)
- `serialize` no longer stamps the schema version (task #12)
- `$schema` placeholder URI → generated local schema file (task #13)

**Reviewed and deliberately kept as-is:**
- `isFinished` leaves stale future dues blocking. Finishing early still requires clearing
  them by hand. Every alternative is a UI behaviour on top of the rule rather than a change
  to it, so the decision was deferred to when the grid exists and the friction is felt.
- Monthly recurrence skips short months and cannot express "end of month". Accepted as a
  known gap — monthly is not a workflow in use; weekly and biweekly are what's needed.
- Merge conflicts resolve toward `ours` and nothing surfaces `MergeResult.conflicts` yet.
  Accepted as sufficiently rare for a single user across two devices.
- Edit beats delete in a merge, so a deleted item can reappear if the other device touched it.
- `orderItems` silently drops grandchildren rather than throwing or re-parenting.
- Window right edge is `max(currentWeek + 2, leftEdge + 3)`, so closing last week shifts the
  grid forward and shows three weeks of runway instead of two.
- `nextOccurrence`'s 400-day scan, `autoClose`'s unreachable iteration cap, and `parse` not
  requiring sorted input.

## Cross-cutting

**camelCase keys in both TypeScript and the on-disk JSON.** The handoff used snake_case
(`parent_id`, `done_on`). A key-mapping layer between file and memory is exactly the kind
of thing that breaks byte-stable round-tripping, and byte-stability is load-bearing: two
clients writing identical state must produce identical files or sync churns on formatting
alone.

**`projectId` rather than `project` on items.** The handoff stored a project name per item.
Storing the id means renaming a project touches one record instead of rewriting every item
in the file — which in a synced, diffable ledger is the difference between a one-line diff
and a whole-file conflict.

**Strict compiler settings** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
These are on deliberately: nearly every value in this package is optional or sparse
(`marks` is a sparse map, half the `Item` fields are optional), and these two flags are
what stop `undefined` leaking into the file.

## `Mark` is a discriminated union — RESOLVED

```ts
type Mark =
  | { kind: 'due' }
  | { kind: 'done' }
  | { kind: 'skip'; provenance: SkipProvenance }
```

Previously `{ kind: MarkKind; provenance?: SkipProvenance }`, where
`{ kind: 'due', provenance: 'deliberate' }` typechecked and only a runtime throw in
`setMark` caught it. That put the invariant at the wrong layer — a bug that could be
impossible to write was instead something you discovered when it threw.

**This changed the file format, not just the types.** `provenance` is now REQUIRED on a
skip, so `{ "kind": "skip" }` is rejected at parse. Defaulting it would have been worse
than rejecting: a skip silently marked `deliberate` makes an absence look like avoidance,
and the skip-streak feature the field exists for would report it that way. There is no
correct default, so there is no default.

Knock-on changes:
- `setMark`'s runtime provenance check is gone — the type does it now. Normalization
  remains, so the stored value is rebuilt from its own fields rather than holding the
  caller's object reference, keeping serialized output canonical.
- Mark equality moved into a `sameMark` helper that compares provenance only on skips.
- `serialize` and `derived` narrow on `kind` before reading `provenance`.
- The old test asserting a runtime throw became a `@ts-expect-error` test, so loosening the
  union back to an optional field now fails the build rather than silently passing.

## `rank.ts`

- Base62 with an **ASCII-ordered alphabet**, so plain `<` on rank strings is rank order and
  callers sort with no comparator.
- **Invariant: a key never ends in `'0'`.** If it did, nothing could sort between a key and
  its own prefix — nothing fits between `"V"` and `"V0"`. Enforced on both input and output.
- `rankBetween` **re-verifies its own output** (valid, strictly between both bounds) before
  returning. A violated ordering invariant corrupts the spine silently and permanently, and
  the check is nearly free.
- `orderItems` **drops grandchildren** rather than rendering them at the wrong depth. Nesting
  is one level by design; a deeper item is a schema violation, and silently flattening it
  would misrepresent the data.
- `minimalMoveRank` returns `null` — meaning *write nothing* — when a drag already satisfies
  its constraint. Verified by test that a repeated identical drag stops writing, so ranks
  converge instead of drifting.

## `dates.ts`

- **All arithmetic in UTC.** These are calendar dates with no time-of-day; local-time math
  would make `addDays` wrong across DST and make week membership depend on the user's
  timezone. There are explicit DST-boundary tests.
- Both `IsoDate` and `IsoWeek` are zero-padded so lexicographic compare is chronological
  compare. Callers rely on this.
- Week tests assert against the **actual design mockup** (`W34 Aug 17–23`, `W35 Aug 24–30`,
  today = Wed 26 Aug 2026). An off-by-one in ISO week math would otherwise be invisible
  until the grid rendered wrong.

## `marks.ts`

- `setMark` **normalizes** the stored shape to `{kind}` or `{kind, provenance}`, dropping
  stray keys, so the serialized form is canonical regardless of how a caller built the object.
- All setters **return the same reference** when the value is unchanged, not just `clearMark`.
  This extends the no-write principle: an edit that changes nothing produces no diff.
- `marksInRange` treats an inverted range as empty rather than throwing. *Flagged for review*
  — a caller could confuse "empty range" with "no marks."

## `recurrence.ts`

- **Monthly skips short months rather than clamping.** An item due on the 31st simply does not
  occur in February. Clamping to the 28th would invent occurrences the user never asked for.
- **Biweekly phase comes from the anchor's ISO week**, via `weeksBetween` — not from
  `daysBetween(anchor, d) % 14`, which breaks when the anchor is not itself an occurrence.
  There is a test named for that trap.
- `nextOccurrence` searches a bounded 400-day window rather than doing frequency-specific
  walking. Correct and simple, but O(window) per call. *Flagged* if it ever becomes hot.
- Month-length arithmetic lives in `recurrence.ts` rather than `dates.ts`, since `dates.ts`
  has no month helpers. *Flagged* — arguably belongs in `dates.ts` for consistency.

## `derived.ts`

- `isFinished` walks marks newest-first, skipping past `skip` kinds, and stops at the first
  non-skip. So `due, skip, skip` is correctly NOT finished — the stale `due` is still the
  latest non-skip mark. This is the literal reading of "latest non-skip mark is done."
- `isGeneratedOccurrence` returns `false` for non-recurring items rather than throwing, so
  close-out can call it unconditionally.
- `rowStyle('skipped')` sets `italic` and `deemphasized` but **never** `strikethrough`.
  Strikethrough is reserved for completion; conflating "I didn't do this" with "I finished
  this" is the wrong signal on a habit the user is trying to break.

## `window.ts`

- Week comparisons use `weeksBetween`, not string compare, so the `W52`/`W53` → `W01`
  rollover is handled rather than relying on lexicographic order across a year boundary.
- Right edge is `max(currentWeek + 2, leftEdge + 3)`. The second term guarantees four blocks
  even when the user is caught up and last week has already been closed away — without it,
  closing last week silently shrinks the grid to three blocks.
- `isOldestUnclosed` is positional (`index === 0`). Equivalent to recomputing, but *flagged*
  as less defensive than an independent check.

## `merge.ts`

- Conflicts resolve toward **`ours`** — the state the user is currently looking at — because
  the file carries no timestamps, so last-writer-wins is not available as a tiebreak. Every
  conflict is **reported** rather than silently applied.
- **Edit beats delete**, both directions. Losing work silently is worse than a stray row the
  user can delete again deliberately.
- `closedThrough` merges as **max**, not as a conflict. Close-out is monotonic — a week never
  re-opens — so two devices closing independently converge instead of fighting.
- Vacation days apply additions from both sides and removals from either.
- Links merge as a **set keyed by url**, so a link resolved on one device and a link added on
  another both survive.
- `deepEqual` treats an absent key and an explicitly-`undefined` key as equal, but `null` as
  distinct — matching the serializer, where `null` is meaningful for `parentId`, `projectId`,
  `recurrence`, and `closedThrough`.

## `serialize.ts` / `parse.ts`

- `$schema` is a **placeholder URI** (`https://murch-todo.dev/schema/ledger-v1.json`) — no such
  document exists yet. Either publish one or drop the field.
- Serialize **always stamps the current `SCHEMA_VERSION`**, overwriting whatever the in-memory
  ledger carried. Harmless in v1 where no migrations exist, but once they do this would let a
  file claim a shape upgrade that never actually ran. Revisit before writing migration code.
- Recurrence field exclusivity is enforced **harder than the type requires**: `weekly`/`biweekly`
  demand `weekday` and forbid `monthday`, and vice versa. Defensible under strict-v1.
- Parse does **not** require input collections to be pre-sorted — only `serialize` produces
  canonical order. So two files holding logically identical state can differ byte-for-byte until
  each has been re-serialized once. Correct division of labour, but worth knowing when diffing.
- **Added after the module landed:** parse now validates `rank` against the base62 alphabet and
  the never-end-in-zero invariant, and checks `projectId` referential integrity (symmetric with
  the existing `parentId` check). Both were gaps the author flagged. The rank check immediately
  caught invalid `'a0'` fixtures in three test files — a plausible-looking key that nothing can
  ever sort between relative to `'a'`. That is precisely the class of silent corruption strict
  parsing exists to prevent, and it argues for keeping v1 strict rather than tolerant.

## `closeout.ts`

- `unresolvedInWeek` scans the **full Mon–Sun week**, not just the five weekday columns the
  grid draws. A due or a recurring occurrence landing on a weekend still has to be resolved.
- `closeWeek` re-derives `isCloseable` internally rather than trusting a caller flag, so it is
  safe to call standalone and fails with a described reason.
- `autoClose` is bounded by a hard iteration cap. Currently unreachable — `oldestUnclosedWeek`
  already clamps a far-future `closedThrough` down to the current week — so the cap is
  defence-in-depth against a future regression rather than a live guard, and it is not
  exercised by a test that actually trips it.

### Two defects found by integration testing, both fixed

Neither was caught by the module's own 18 tests; both surfaced the moment the modules were
composed in a realistic session. Worth remembering as an argument for keeping the end-to-end
test alive as the package grows.

1. **`isCloseable` returned an inconsistent result.** `closeable` was computed from explicit
   dues *and* generated occurrences, but `blockers` reported only the explicit ones. A week
   blocked solely by a recurring occurrence therefore returned `closeable: false` with
   `blockers: []` — a UI reading that renders "cannot close, nothing is blocking."
   Fixed: `blockers` now reports everything, tagged `kind: 'explicit' | 'generated'`. Callers
   wanting only human-actionable backlog filter on `kind`.

2. **`closeWeek` threw a wrong error.** Its fallback message assumed an empty blocker list
   meant the week was current or future, so blocking on a recurring occurrence produced
   *"Cannot close 2026-W34: it is the current or a future week"* for a week that was squarely
   in the past. That would send someone debugging week arithmetic that was never wrong.
   Fixed by (1), plus the message now names the blocker kind.

Regression tests added: a week blocked only by a generated occurrence reports non-empty
blockers; `closeable: false` never coexists with an empty blocker list for a past week; and the
thrown message names the real cause.

## `ledger.ts` — construction helpers (new)

`createLedger(init?)` and `createArchive(week, items)` stamp `SCHEMA_VERSION` and sensible
defaults. They exist so there is exactly ONE obvious correct way to build a new header, now
that `serialize` no longer supplies the version itself.

**They are for genuinely new ledgers only.** Rebuilding a parsed ledger through
`createLedger` would discard the file's real version and reintroduce the exact bug task #12
removed — that is called out in the module doc.

### Version handling — RESOLVED (task #12)

`serialize` now writes `ledger.version` verbatim; likewise `serializeArchive`. `$schema` and
`$agent` are still force-written, since they are advisory strings with no correctness role.
Full contract in `MIGRATIONS.md`.

Two notes on the regression test, because this is easy to get wrong:

- It uses **`version: 0`**, deliberately not `SCHEMA_VERSION`. A test using version 1 would
  pass identically against the buggy and the fixed implementation, and would therefore have
  been worthless as a guard.
- One pre-existing test asserted `out.version === SCHEMA_VERSION` and *looked* like coverage,
  but only passed because its fixture happened to use `SCHEMA_VERSION` as its version. It
  would have kept passing under either contract. Narrowed to cover `$schema`/`$agent` only.

*Flagged:* because `parse` rejects `version < 1`, the `version: 0` tests exercise
`serialize`/`serializeArchive` directly rather than a full parse round-trip. Adequate for the
invariant being guarded, but it is not an end-to-end path.

## `$schema` — RESOLVED (task #13)

`SCHEMA_URI` is now `'./ledger.schema.json'` — a relative path resolved beside the ledger
file. The old value was `https://murch-todo.dev/schema/ledger-v1.json`, a placeholder invented
during the build: nobody owned the domain and nothing was published there. Since editors
actually fetch `$schema` for validation and autocomplete, that was a broken promise to tooling
aimed at a domain a third party could have registered.

**Generated, never hand-written.** `scripts/generate-schema.ts` emits `ledger.schema.json` from
`types.ts` via `ts-json-schema-generator` (`npm run generate:schema`). A hand-maintained schema
drifts from the types, which is the entire tax this approach avoids.

**The generator did NOT get both hard parts right on its own — `postProcess()` in the script
fixes two things, and that is a standing maintenance liability worth knowing about:**

- **`Mark`**: the generator got the hard part right unassisted — three branches, `const` on
  `kind`, `additionalProperties: false` per branch, `provenance` required only on the skip
  branch. But it joined them with `anyOf`; post-processing rewrites that to `oneOf`. Behaviour
  is identical here since the branches are mutually exclusive by construction, so this one is a
  semantic correctness fix rather than a functional one.
- **`marks`**: the generator emitted a bare `additionalProperties: {$ref: Mark}` with **no key
  constraint whatsoever** — a garbage key like `"not-a-date"` would have validated. Post-
  processing rewrites it to `patternProperties` keyed `^\d{4}-\d{2}-\d{2}$` with
  `additionalProperties: false`. This one is a real hole that post-processing closes, and it is
  the case the ajv test for bad date keys exists to guard.

`postProcess()` **throws** if the generator's raw output shape ever changes underneath either
fixup (e.g. `Mark` stops being an `anyOf`, or `marks.additionalProperties` stops being a `$ref`)
rather than silently no-op'ing and emitting a weaker schema. That is the mitigation, but a
generator upgrade should still be treated as a change that needs the output re-read by eye.

**Two tests guard it.** A drift test shells out to the real generator script (not a
reimplementation) and compares **bytes**, not parsed JSON — so nondeterministic output, unsorted
keys or a timestamp, fails too. Verified independently: regenerating twice produces an identical
file. Then ajv validation tests prove the schema actually *enforces* the contract rather than
merely being shaped plausibly — a skip without provenance, a due carrying provenance, an item
missing `rank`, and a bad date key all must fail.

The invalid-data cases are built as loose object literals rather than typed `Ledger` values,
deliberately: TypeScript won't let you construct them at all, which is the point — the schema
has to catch what the type system only catches for callers already writing TypeScript.

**Dependency pinning — do not casually upgrade.** `ts-json-schema-generator` is pinned to
`1.5.1`. Node here is 18.12.1; the 2.9.x line requires Node >= 22, and 2.4.0 *declares*
`engines: >=18` but still crashes at require time — it pulls `glob@11` → `lru-cache@11`, which
calls `diagnostics_channel.tracingChannel`, added in Node ~20. The declared engine range is
wrong, and this was found by actually loading the package rather than by reading `engines`.

The generator also runs with `skipTypeCheck: true`, to sidestep the package tsconfig's `types`
array (irrelevant to `types.ts` but not resolvable from the generator's own TS program).
`types.ts` is still fully checked by the package's `tsc --noEmit`.

**Toolchain note:** this pulled in `ts-json-schema-generator`, `ajv`, `tsx`, and `@types/node`
as devDependencies. The schema test imports `node:*` builtins, so the package tsconfig's `types`
array needed `"node"` added alongside `"vitest/globals"` — without it, `tsc --noEmit` failed
while vitest still passed, so **typecheck and tests disagreed**. Worth remembering: a green test
run here does not imply a clean typecheck.

*Not built:* versioned schema filenames. A v2 will need them — see `MIGRATIONS.md`.

---

# `@murch-todo/cli`

## Packaging

**esbuild bundle, not a two-stage compile.** `ledger-core` exports TypeScript source
(`main: ./src/index.ts`) — good for vitest and for the web app's bundler, but node cannot run
it directly. Bundling the CLI resolves that at build time instead of forcing `ledger-core` to
also emit `dist/`, or making `tsx` a runtime dependency and paying its startup cost on every
invocation. Output is one ~5KB file with a shebang.

**Zero-dependency argument parsing** (`node:util` `parseArgs` plus a subcommand switch). This is
a tool agents install transiently via `npx`, so install weight is a real cost, and the surface
is small enough that a framework would be more indirection than it removes.

## Ledger path resolution

`--ledger` → `$LEDGER_FILE` → `~/.ledgerrc` → `~/todo/personal.ledger.json`.

**Deliberately no search up the current directory tree**, which is the usual convention for dev
tools. The ledger lives in a synced folder (Drive, Dropbox) that has nothing to do with wherever
a command is run from, so cwd carries no signal — and a cwd-sensitive default would make the
same command write to different files depending on where it happened to be invoked. For an
agent running commands from arbitrary directories, that is a silent-wrong-file hazard.

Resolution is a pure function taking flag/env/rc contents, so it is tested without touching the
filesystem or environment.

## Exit codes

Distinct codes per failure class — `USAGE` (2), `CONFLICT` (3), `FILE` (4) — because agents
branch on them. A single catch-all `1` would force an agent to parse stderr prose to decide
whether to retry, fix its input, or stop.

## `today` is resolved once, by the dispatcher

Commands never read the clock; `today` is passed down, mirroring `ledger-core` where every
date-dependent function takes it as a parameter. `--today` overrides it for testing.

The dispatcher derives it from **local** time, not UTC. `ledger-core` does its arithmetic in
UTC, but *which day it currently is* is a local question — a user in UTC+13 marking something
done at 9am must not have it land on yesterday.

## File I/O — the risky layer (task #15)

`ledger-core` is pure and exhaustively tested, so essentially every genuinely new bug lives here.

**Staleness is detected by comparing file CONTENT, not mtime.** Many filesystems report mtime at
1-second granularity, so two writes inside the same second are indistinguishable by `stat` — and
a script making several edits in a row would hit exactly that. Content comparison has no blind
spot, and the file is a few KB, so re-reading before every write costs nothing. There is a test
that writes a concurrent change within the same timestamp tick.

**Atomic write: temp file in the SAME directory, fsync, rename.** Same directory matters —
`rename` is only atomic within a filesystem, so a temp file in `/tmp` could land on a different
device and silently degrade to a copy, reintroducing the partial write this exists to prevent.
The `fsync` matters too: without it the rename can be durable while the data is still buffered,
yielding an intact-looking file with truncated contents after power loss. This is a file that
replicates to every device within seconds, so a partial write is not a local problem.

**Known race, accepted deliberately:** between the staleness re-read and the rename. Closing it
needs a lock file, which brings its own failure mode (stale locks after a crash). For one user
across a laptop, a phone and an occasional agent, a microsecond window is not worth that.

**Merge on conflict, never clobber.** A detected concurrent change triggers ledger-core's
three-way merge with the loaded baseline. `SaveResult.conflicts` is returned so commands can
surface it — the CLI is the first consumer of `MergeResult.conflicts`, which until now went
nowhere.

**Refusals that protect data:** `createLedgerFile` will not overwrite an existing ledger, and
`writeArchive` will not overwrite an already-closed week. `ensureSchemaFile` never overwrites
either, since a newer app version may have written a newer schema.

**A `FutureVersionError` message deliberately suggests nothing that writes.** An older client
"fixing" a newer file would drop fields it does not understand and replicate that loss to every
device. There is a test asserting the message does not mention `ledger init`.

## Output layer and the JSON contract (task #17)

```jsonc
// success
{ "ok": true, "data": { /* per-command */ } }
// failure
{ "ok": false, "error": { "code": 3, "message": "...", "detail": {} } }
```

`error.code` is the SAME numeric value the process exits with, so `$?` and the JSON payload can
never disagree and there is no second code table to keep in sync.

*Open question deliberately left for integration:* a numeric `3` is less self-documenting than
`"CONFLICT"` for an agent reading JSON without `exit.ts` in front of it. Adding a `codeName`
string alongside the number is additive and cheap now; changing this shape later is not, since
agents will already be parsing it.

**Hard rules the layer enforces:**
- Data on stdout, diagnostics on stderr, never interleaved — so `ledger list --json | jq` keeps
  working even when a warning fires. There is a test for exactly that regression.
- Under `--json`, `error()` writes the envelope to stdout AND the plain message to stderr, so a
  piped consumer always receives exactly one JSON object rather than nothing.
- Colour is decided ONCE at `createOutput()` from `NO_COLOR` and TTY-ness, never re-sniffed per
  call, and is injectable so tests never depend on the ambient terminal.
- Derived state renders through ledger-core's `rowStyle`, and always carries a plain-text marker
  (`✓` finished, `~` skipped, ` ` open) in addition to any styling — ANSI is invisible to agents
  and to piped output, so styling alone would make the three states indistinguishable there.
- `skipped` never receives the strikethrough sequence, only italic + dim. Locked down by test.

## Shared command helpers

**`resolve.ts` — item lookup.** Exact id wins; otherwise a case-insensitive title match,
preferring prefix over substring. An ambiguous query is an ERROR listing candidates, never a
guess: `ledger done proj` silently completing the wrong row is invisible at the time and, once
the week closes, effectively permanent. Agents should pass ids.

**`session.ts` — the mutation wrapper.** Every mutating command goes through `mutate()`, so
surfacing merge conflicts is STRUCTURAL rather than per-command discipline. `MergeResult.conflicts`
had no consumer before the CLI; leaving reporting to individual commands meant one forgetful
command would silently discard another device's edit. Conflicts are reported individually with
the kept and discarded values — a bare count tells the user nothing actionable, and since the
merge resolves toward ours, the other side's edit is gone unless they can see what it was.

`apply` returning `null` means "no change": no write, no mtime change, no diff in a synced
folder. `minimalMoveRank` returning null is precisely this case.

## Commands — three bugs found by integration, not by unit tests

All three surfaced only once commands, I/O and the dispatcher were combined and driven
end-to-end. Every module typechecked and passed its own tests first. This is the second time
in this project that composition found what isolation could not.

**1. Global flags leaked into command argv.** Commands parse with `strict: false` so they can
ignore flags they do not know — but an undeclared `--ledger /path` does not vanish: `parseArgs`
returns the VALUE as a positional. So `ledger add "buy milk" --ledger ~/x.json` created an item
titled `buy milk /Users/me/x.json`. Fixed with `stripGlobals()` in the dispatcher, so every
command sees only its own arguments and global flags work in any position.

**2. `move` rewrote the rank on every no-op.** `move b --after a` computed the moving item as
its own upper neighbour, asking `b` to sort strictly before itself — impossible, so
`minimalMoveRank` always reported a violation. The exact behaviour the minimal-move design
exists to prevent: a pointless rank rewrite and a spurious diff in a synced folder on every
drag. Fixed by excluding the moving item from its own neighbour computation. Regression test
asserts the file is byte-identical after a no-op move.

**3. Thrown errors produced no JSON envelope.** `cells.ts` caught `CliError` and called
`out.error()`, so `--json` consumers got a proper envelope. The commands I wrote threw instead,
and the dispatcher only wrote to stderr — so a piped agent received NOTHING on stdout and could
not distinguish a failure from a crash. Fixed in the dispatcher, which now renders errors
through `createOutput` for every command. Worth noting the delegated module was more correct
here than mine.

## Agent discovery (task #23)

`ledger init` provisions the whole folder: the ledger, `ledger.schema.json`, `AGENTS.md`, and
`CLAUDE.md`. None of them are ever overwritten — a user may have their own instructions there.

`CLAUDE.md` is a POINTER to `AGENTS.md`, not a copy. Two verbatim copies of the same rules drift
the moment one is edited.

Plus `.claude/skills/ledger/SKILL.md`, which bundles the CLI rather than only describing it.

The docs deliberately lead with *why hand-editing corrupts the file* — derived finished state,
generated-not-stored occurrences, fractional ranks, required skip provenance — because an agent
that understands the reasoning will not improvise around the rules. These are conventions with
no enforcement; the real protection is that the sanctioned path is easier than hand-editing.

## Command unit tests (tasks #24–#26) — two more bugs, both mine

Delegated to three parallel Sonnet agents after the e2e suite covered only happy paths.
`cells.ts` and `closeout.ts` came back clean on first pass. The two modules I wrote did not.

**1. `rm` under `--json` deleted without `--force`.** The guard read
`if (!values.force && !ctx.json)`. The `--json` exemption was meant to skip interactive
confirmation, but `--json` is documented purely as an output-format modifier — and it is the
PRIMARY interface agents use. So the sanctioned agent path was the unsafe one: an agent that
simply forgot `--force` destroyed data instead of receiving a structured refusal. There was
never a functional reason for the exemption either, since the dispatcher already renders a
thrown `CliError` as a proper JSON error envelope. Now `--force` is required unconditionally.

**2. `--after`/`--before` accepted an anchor from a different rank scope.** Ranks are
sibling-scoped. Naming an anchor with a different parent made `findIndex` return `-1`, so
`scope[idx + 1]` silently resolved to `scope[0]` and the item landed at an arbitrary position —
or threw an opaque `RankError` from inside `rankForInsert`, depending on how the ranks happened
to compare. Now rejected with a message naming the actual problem.

Both are the same class of mistake: a guard that looked right in isolation and only failed
under a combination the module's own tests never produced.

## Known gap — no CLI path to backdate a recurrence

`add --recur` always anchors to today, so a recurring item cannot be created with occurrences
already in the past. The closeout tests had to backdate `recurrence.anchor` by writing JSON
directly — precisely what the CLI exists to prevent. Tracked as task #27; it matters mainly
because the agent docs say "never hand-edit" while leaving one case that requires it.

### A third bug — `list --week` hid the marks close-out blocks on

`list --week` narrowed to `weekdayDates` (Mon–Fri, the grid's five columns) while
`unresolvedInWeek` scans `allWeekDates` (Mon–Sun). So a Saturday due blocked the week from
closing while being INVISIBLE in `list --week`: `status` reported the blocker, and the one
command a user would reach for to find it showed the item with no marks at all. Dead end.

Reproduced against the built binary before fixing. `list` now uses the full seven days,
matching close-out. Regression test asserts a Saturday due appears under `--week`.

Worth noting how this one surfaced: the agent that found it wrote NO failing test and reported
"bugs found: none" — it flagged the weekday-only narrowing as a *product question* ("worth
confirming that's the desired behaviour"). It only became a bug when checked against
close-out's behaviour in another module. The two modules were each self-consistent; the
contradiction lived between them.

**Pattern across this project, now four for four:** every bug that reached the user-visible
layer was a disagreement BETWEEN correct-looking modules — close-out's blocker list vs. its own
closeable flag, global flags vs. command parsers, `--json` as output format vs. as permission,
and now list's week vs. close-out's week. Module-level tests cannot see any of them. The
end-to-end suite and cross-module reasoning are what earn their keep here.
