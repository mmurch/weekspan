# Implementation Notes — `weekspan-core`

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
in the file — which in a synced, diffable weekspan is the difference between a one-line diff
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

### Vacation days suppress generated occurrences (task #58)

- `effectiveMark` and `isGeneratedOccurrence` take `vacationDays` as a **required** third
  argument. That was the bug: both took only `(item, date)`, so a recurring rule firing on a
  vacation day rendered a `due` chip in a hatched cell and blocked close-out. A defaulted
  `[]` would have let the next caller reintroduce it silently, so the parameter is required
  and the compiler names every call site.
- **Suppress, don't shift.** A rule firing on a vacation day renders nothing; the next
  occurrence still lands on the date the rule names. Shifting it to the next working day
  would materialize a due on a date the rule never generated — the one thing derived state
  must not do — and would drag in a tail of edge cases (runs of vacation days, week
  boundaries, a destination that already has a mark).
- The complement already existed: `toggleVacation` (web) shifts **explicit** dues forward
  per the design. Explicit marks are untouched here — they still render on a vacation day
  and still block close-out. Days get marked vacation after the fact, and hiding a
  completion the user recorded would destroy history at the render layer.
- Falls out of this for free: `autoClose` writes **no** auto-skip for a suppressed
  occurrence, so a fortnight away leaves no trail of skip marks. That is what "the week
  still closes normally" means in the design.
- `displayState` deliberately does NOT take `vacationDays`. It only scans explicit marks in
  the current period — it never synthesizes — so vacation cannot change its answer.

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

- `$schema` is a **placeholder URI** (`https://murch-todo.dev/schema/weekspan-v1.json`) — no such
  document exists yet. Either publish one or drop the field.
- Serialize **always stamps the current `SCHEMA_VERSION`**, overwriting whatever the in-memory
  weekspan carried. Harmless in v1 where no migrations exist, but once they do this would let a
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

## `weekspan.ts` — construction helpers (new)

`createWeekspan(init?)` and `createArchive(week, items)` stamp `SCHEMA_VERSION` and sensible
defaults. They exist so there is exactly ONE obvious correct way to build a new header, now
that `serialize` no longer supplies the version itself.

**They are for genuinely new weekspans only.** Rebuilding a parsed weekspan through
`createWeekspan` would discard the file's real version and reintroduce the exact bug task #12
removed — that is called out in the module doc.

### Version handling — RESOLVED (task #12)

`serialize` now writes `weekspan.version` verbatim; likewise `serializeArchive`. `$schema` and
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

`SCHEMA_URI` is now `'./weekspan.schema.json'` — a relative path resolved beside the weekspan
file. The old value was `https://murch-todo.dev/schema/weekspan-v1.json`, a placeholder invented
during the build: nobody owned the domain and nothing was published there. Since editors
actually fetch `$schema` for validation and autocomplete, that was a broken promise to tooling
aimed at a domain a third party could have registered.

**Generated, never hand-written.** `scripts/generate-schema.ts` emits `weekspan.schema.json` from
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

The invalid-data cases are built as loose object literals rather than typed `Weekspan` values,
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

# `@weekspan/cli`

## Packaging

**esbuild bundle, not a two-stage compile.** `weekspan-core` exports TypeScript source
(`main: ./src/index.ts`) — good for vitest and for the web app's bundler, but node cannot run
it directly. Bundling the CLI resolves that at build time instead of forcing `weekspan-core` to
also emit `dist/`, or making `tsx` a runtime dependency and paying its startup cost on every
invocation. Output is one ~5KB file with a shebang.

**Zero-dependency argument parsing** (`node:util` `parseArgs` plus a subcommand switch). This is
a tool agents install transiently via `npx`, so install weight is a real cost, and the surface
is small enough that a framework would be more indirection than it removes.

## Weekspan path resolution

`--weekspan` → `$WEEKSPAN_FILE` → `~/.weekspanrc` → `~/todo/personal.weekspan.json`.

**Deliberately no search up the current directory tree**, which is the usual convention for dev
tools. The weekspan lives in a synced folder (Drive, Dropbox) that has nothing to do with wherever
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

Commands never read the clock; `today` is passed down, mirroring `weekspan-core` where every
date-dependent function takes it as a parameter. `--today` overrides it for testing.

The dispatcher derives it from **local** time, not UTC. `weekspan-core` does its arithmetic in
UTC, but *which day it currently is* is a local question — a user in UTC+13 marking something
done at 9am must not have it land on yesterday.

## File I/O — the risky layer (task #15)

`weekspan-core` is pure and exhaustively tested, so essentially every genuinely new bug lives here.

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

**Merge on conflict, never clobber.** A detected concurrent change triggers weekspan-core's
three-way merge with the loaded baseline. `SaveResult.conflicts` is returned so commands can
surface it — the CLI is the first consumer of `MergeResult.conflicts`, which until now went
nowhere.

**Refusals that protect data:** `createWeekspanFile` will not overwrite an existing weekspan, and
`writeArchive` will not overwrite an already-closed week. `ensureSchemaFile` never overwrites
either, since a newer app version may have written a newer schema.

**A `FutureVersionError` message deliberately suggests nothing that writes.** An older client
"fixing" a newer file would drop fields it does not understand and replicate that loss to every
device. There is a test asserting the message does not mention `weekspan init`.

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
- Data on stdout, diagnostics on stderr, never interleaved — so `weekspan list --json | jq` keeps
  working even when a warning fires. There is a test for exactly that regression.
- Under `--json`, `error()` writes the envelope to stdout AND the plain message to stderr, so a
  piped consumer always receives exactly one JSON object rather than nothing.
- Colour is decided ONCE at `createOutput()` from `NO_COLOR` and TTY-ness, never re-sniffed per
  call, and is injectable so tests never depend on the ambient terminal.
- Derived state renders through weekspan-core's `rowStyle`, and always carries a plain-text marker
  (`✓` finished, `~` skipped, ` ` open) in addition to any styling — ANSI is invisible to agents
  and to piped output, so styling alone would make the three states indistinguishable there.
- `skipped` never receives the strikethrough sequence, only italic + dim. Locked down by test.

## Shared command helpers

**`resolve.ts` — item lookup.** Exact id wins; otherwise a case-insensitive title match,
preferring prefix over substring. An ambiguous query is an ERROR listing candidates, never a
guess: `weekspan done proj` silently completing the wrong row is invisible at the time and, once
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
ignore flags they do not know — but an undeclared `--weekspan /path` does not vanish: `parseArgs`
returns the VALUE as a positional. So `weekspan add "buy milk" --weekspan ~/x.json` created an item
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

`weekspan init` provisions the whole folder: the weekspan, `weekspan.schema.json`, `AGENTS.md`, and
`CLAUDE.md`. None of them are ever overwritten — a user may have their own instructions there.

`CLAUDE.md` is a POINTER to `AGENTS.md`, not a copy. Two verbatim copies of the same rules drift
the moment one is edited.

Plus `.claude/skills/weekspan/SKILL.md`, which bundles the CLI rather than only describing it.

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


## Date-word vocabulary lives in weekspan-core (task #38)

`tryParseDateWord` / `parseDateWord` in `packages/weekspan-core/src/datewords.ts` are the single
implementation of the `thu` / `today` / `+3d` vocabulary. The CLI and the web quick-capture both
call it; neither has a copy.

It was duplicated for a while — once in `packages/cli/src/dates.ts`, once privately inside
`apps/web/src/add/capture.ts` — with nothing enforcing parity. The failure mode is silent and
nasty: an agent adding `thu` through the CLI and a person typing `thu` in quick capture could
land on different days, with nothing anywhere to flag the divergence.

**Core throws a plain `Error`, never `CliError`.** weekspan-core has no dependency on the CLI and
must not gain one, so `packages/cli/src/dates.ts` is now a thin adapter that catches and re-wraps
as `CliError(msg, EXIT.USAGE)`, preserving the CLI's exit-code contract.

The CLI's 33-test spec moved into core essentially intact rather than being rewritten — it was the
more thorough of the two. Two parity guards were added on top: a 21-case table in core, and
`apps/web/src/add/parity.test.ts`, whose expected dates were produced by running the BUILT CLI
binary rather than by reading the implementation. The web-side test is structurally redundant while
both call the same function; it exists to fail loudly if someone reintroduces a local copy.

*Flagged:* the CLI's user-facing error message now comes from core's error text verbatim, so
changing the wording in core changes the CLI's output. That coupling is the point, but it means
message-stability assertions exist on both sides of the boundary.

## Project view was inert — three interactions, one missing wire

Reported as three separate bugs (no drag reordering, no dragging into a project, no inline
create). Two of the three were the same missing wire.

**The drag.** `useDragPreview` was handed Priority view's `vm`, while `handleProjectReorder`
resolved the drop against `projectVm.rows`. `dropFromRows` was always written to read the
PREVIEWED rows — "what you see is what commits" — but nothing produced a previewed project
list, so it got the committed one, found the item exactly where it already was, and resolved
to its own current group and neighbours. `minimalMoveRank` then correctly returned null and
`applyProjectDrop` correctly wrote nothing. Every function passed its own tests; the failure
lived entirely between them.

- `projectDragPreview.ts` is the missing half: the same lift-and-reinsert as `dragPreview.ts`,
  but over a list that contains dividers. Dividers are load-bearing — a slot immediately after
  one is what "first item of this group" means, and it is the ONLY landing slot for a group
  that is currently empty, so they must be in the index space.
- Identity is positional, not by id. Item ids come from the file and divider keys are project
  ids; one shared string namespace would be a collision waiting to happen.
- Indices are in REST space (the list with the dragged group already removed). Both preview
  functions agree on that, and it is now stated in the doc comment — computing against the
  full list is off by one whenever the dragged row sits above the target, which is exactly
  the bug the first version of the test had.
- The pointer lifecycle (threshold, lift, Escape, commit-on-release) is identical in both
  views, so `useDragPreview` now takes a `DragAdapter<T, B>` instead of a `GridVM`. `B` — the
  measured-box shape — stays opaque to the hook, so neither view needs a cast. Both adapters
  are built every render and both hooks always run; only the active view's ever sees a
  pointerdown.

**Inline create.** Project view rendered no `<Seam>` and no `<DraftRow>` at all. Adding them
surfaced a second, pre-existing bug: the draft was keyed by `draftAfterId`, the id of the row
above it, so the two slots with no row above them — the top of Priority view, and the first
position in a group — opened a draft that then rendered nowhere. Replaced with `draftSlot`,
a key of `top` / `after:<id>` / `group:<dividerKey>`, computed by `draftSlotKey` in App and
matched in Grid.

`EditTarget.new` gained an optional `projectId` so a seam inside a group creates INTO that
group. Absent means "no opinion" (Priority view, which has no groups); `null` is the real,
distinct value for the unassigned bucket.

*Flagged:* a project group is NOT a rank scope. `projectSeamParentId` stops its walk at a
divider, so grouping is never mistaken for nesting.

### `scripts/probe-project-view.mjs` — because unit tests could not have caught this

Every pure function involved was correct and tested. The bug was in the wiring, which only
exists once the app is assembled, so the probe drives the built single-file app in a real
browser and asserts on the DOM: a drag files an item into another group, a seam opens a
draft, the draft commits into the group it was opened in. Reintroducing the original one-line
bug fails it. Wired into `npm run verify` (`probe:project`).

The probe strips `document.documentElement.style.zoom` before driving anything. CSS `zoom`
puts layout and visual coordinates in different spaces — documented in App.tsx as harmless
for real users but fatal for synthetic pointer coordinates, and it is: Playwright reported
the Priority button intercepting clicks aimed at Project, 30px away.

## View toggle read backwards (`.ws-seg`)

The SELECTED segment carried a solid dark fill — this app's primary-action look, the same as
`.ws-rail-btn--dark` — so it read as "press me". The unselected one sat at `--ws-ink-3`, the
muted ink used for disabled metadata, so it read as unavailable. Both signals inverted.

Now a proper segmented control: one recessed track (`.ws-seggroup`), the current view a raised
pill on it (full ink, weight 600, own surface and hairline), the other plain readable ink with
a hover fill. The pill says position, never action.

Built from ink, weight and hairline rather than a light/dark fill relationship on purpose:
`--ws-panel` sits ABOVE `--ws-subtle` in Paper and BELOW it in both dark themes, so a fill
alone would flip meaning between themes. Weight and ink contrast do not. Verified by
screenshot in all three. `aria-pressed` carries the state for screen readers, since the pill
styling says nothing to them.

## Filter now hides non-matches (was: showed them, undimmed)

`filterRows` widened its result to keep a match's parent or children on screen as context,
tagging them `contextOnly` for the UI to dim. **Nothing ever consumed that flag.** So context
rows rendered identically to real matches, and typing a term left items on screen that plainly
did not contain it — with no way to tell which was which. That is the bug; the flag was a
design that was never finished.

Rather than wire up the dimming, the widening is gone. "Show me what matches" is what the box
appears to promise, and a filtered list is a lookup tool, not a place to read hierarchy. The
cost, stated in the code: a matching child whose parent does not match keeps its depth-1
indent with nothing above it. That reads as a slightly indented row, not a broken tree.

**Project view honoured the filter not at all** — `Grid` ignores `previewRows` in its project
branch, so the filtered array never reached it. `filterProjectRows` fixes that, and drops a
group divider when nothing under it survived: an empty group header standing over nothing is
the same failure as a context row.

Both views read ONE id set (`matchedIds` in App), computed once from the same `RowVM[]`, so a
term can never show an item in one view and hide it in the other. There is a test for exactly
that.

## Drag auto-scroll (and the "row detaches from the cursor" symptom)

Two reported symptoms, one root cause each, and they had to be fixed together.

- **Scrolled far too late.** There was no auto-scroll at all; the only scrolling was the
  browser's own, once the pointer left the window. `autoscroll.ts` starts at 72px from either
  edge — deliberately generous, because the sticky header rows eat the top ~58px of the scroll
  box and a tight zone would only trigger once the row was already hidden behind them. Speed
  ramps linearly from 0 at the zone boundary to 18px/frame at the edge, then holds. Constant
  speed inside the zone was the obvious alternative and feels much worse: it lurches the
  instant you enter, with no way to nudge by a row.
- **Row appeared disjointed from the cursor.** It was never attached — `liftY` was computed on
  every pointermove and **read by nothing** (now deleted). The row is highlighted in its
  previewed position, and that position had stopped tracking: `boxes` are viewport rects
  measured ONCE at pointerdown, so any scroll invalidated all of them by the scroll delta.

  Fixed by adding the delta to the pointer instead of re-measuring, which is the same
  comparison — `pointerY > box.top - delta + h/2` ⟺ `pointerY + delta > box.top + h/2` — at one
  subtraction per frame instead of a `querySelector` per row. Verified in a browser: after
  352px of auto-scrolling, the dragged row sits exactly under the cursor (index gap 0).

Auto-scroll runs off `requestAnimationFrame`, not off pointermove: holding the pointer still
inside the edge zone must keep scrolling, and a stationary pointer emits no move events. It
recomputes the preview only when `scrollTop` actually changed, so a container already pinned at
an end does not re-render the grid every frame.

## Sticky headers were translucent (day/date row)

`--ws-weekend-bg` and `--ws-past-tint` are translucent BY DESIGN — on a cell they are a wash
laid over the row beneath, which is right, and `.ws-cell--weekend` / `.ws-cell--past` still use
them raw. But `.ws-day` is `position: sticky`, and setting the tint as the whole background
replaced the opaque `--ws-subtle` base with a 3%-alpha film. Every row scrolling under the
header showed straight through it — chips, gridlines and all. `.ws-head-weekendspacer` had the
same bug.

Fixed by layering the tint over `--ws-subtle` as a gradient
(`linear-gradient(tint, tint), var(--ws-subtle)`), which keeps the intended colour to the pixel
while making the result opaque. Done in CSS rather than by inventing per-theme opaque tokens so
the four themes stay in sync for free. Audited every `position: sticky` rule in `Grid.css`;
these two were the only translucent ones.

## Distribution — `npm run release` and the `weekspan-setup` skill

The fact that decides the whole question: the web app builds to ONE self-contained HTML file
that runs from `file://`. **The repo is not a prerequisite for USING weekspan, only for
changing it.** So the answer to "zip the repo and Slack it to myself" is no — send the 263KB
HTML file.

`scripts/package-release.mjs` (`npm run release`) stages `dist-release/`. A `.zip` is emitted
alongside the loose files because corporate mail and Slack filters routinely strip `.html`
attachments — send whichever gets through.

**A real defect surfaced while verifying the artifact**, which is the argument for testing a
release rather than assuming it: `init` locates `weekspan.schema.json` and the AGENTS.md /
CLAUDE.md templates by walking RELATIVE to its own module path. esbuild bundles the CLI to a
single file, and copying that file out of the workspace put weekspan-core permanently out of
reach — so `init` on a fresh machine silently produced a bare ledger with a warning and none of
the three agent-facing files. Fixed by adding a beside-the-executable candidate path in
`init.ts` and shipping the sidecars in `dist-release/`. Verified by running the packaged CLI
from `/tmp` against an empty directory: all four files now written, no warning.

Also confirmed the packaged app is genuinely standalone — opened from a bare `/tmp` directory
with no repo and no `node_modules`, it renders 8 rows and 224 cells with zero console errors.
It makes exactly one external request, for IBM Plex from `fonts.googleapis.com`; a proxy
blocking that costs the typeface and nothing else. Noted in the artifact's own README, since a
work machine is where that matters.

`.claude/skills/weekspan-setup/` is the other half: land the repo, ask Claude or Cursor to run
it. It leads with "does this person actually need the repo?" — the honest answer is usually no.

## Google Drive as source of truth — `docs/google-drive-sync.md`, NOT implemented

Investigated and deliberately left unbuilt, per explicit instruction to stop if there was no
obvious low-disruption answer. There isn't.

The finding worth keeping here: **the app does not need to know what Drive is.** `useWeekspan`
already polls every 2s, and `FileSystemStore.write()` already re-reads and runs the semantic
three-way `merge()` rather than clobbering. Anything that keeps the local file in step with
Drive inherits sync, change detection and conflict resolution for free. The question reduces to
what moves bytes, which is exactly the position ARCHITECTURE.md already takes.

Browser-direct Drive is structurally dead, not merely hard: the app ships as a `file://` page,
which has a **null origin**, and Google OAuth cannot register a null origin. Hosting the page
over HTTPS would fix it — and would also make the File System Access API work, which is already
built and tested, so it buys nothing for real cost.

## Drag reorder reverted on release — 100% of nested rows, not 50% of all rows

Reported as "broken about 50% of the time". A stress probe over both fixtures found the real
shape: **every drag of a depth-1 child reverted (4/4), every drag of a root committed
(64/64).** It reads as intermittent because whether it works depends on which row you grabbed,
not on chance.

`commitNeighbours` only ever accepted SIBLING neighbours, but nothing stopped the PREVIEW from
carrying a row past them. A child dragged out of its parent's run resolved to
`before = null, after = null`; `minimalMoveRank` correctly read that as "no constraint left to
satisfy" and returned null; the write never happened and the row snapped back with no
explanation.

Fixed by teaching the preview to promise less, not the commit to accept more —
`dragPreview.ts`'s own principle is that the preview IS the answer, so a position it will not
commit is a position it must not show. `validIndices` enumerates the legal slots (a child only
between its own siblings; a root only where a root may begin) and the index snaps to the
nearest one. The row now visibly refuses an illegal slot instead of following the cursor there
and silently doing nothing.

The regression test states the invariant directly rather than re-testing the symptom: for every
row and every index, any previewed order that differs from the current one must yield
non-null `commitNeighbours`. Post-fix stress: 0 reverts across both fixtures, children 13/13.

*Not a regression from the project-view work* — this predates it. The adapter refactor moved
the code but not the bug.

## A brand-new weekspan starts at THIS week

`oldestUnclosedWeek` treated `closedThrough: null` as "last week is unclosed", so opening a
fresh file put an empty, uncloseable past week on screen: the app looked behind before anything
had been entered.

Now, when `closedThrough` is null AND no explicit mark exists before this week, the left edge
IS this week. Deliberately narrow:

- **Explicit marks only.** A recurring rule with an old anchor fires through all of history,
  which would make every new file look like it had a backlog on day one.
- **A display rule, not a close-out.** `closedThrough` is not written and nothing is archived —
  which is what "without implementing auto-closeout" required. The moment a mark exists in a
  past week the edge moves back to include it, which is exactly what happens next week, so the
  week you just used stays visible and closeable.
- **Conservative on existing files.** Any file with history behaves as before.

Seven tests across the CLI and web broke, all fixtures that were fresh ledgers standing in for
"a normal file". Each was given real history rather than having its expectation moved — a
"closeable past week" with literally nothing in it was a degenerate case worth losing.

## Favicon

`apps/web/favicon.svg` — a calendar with wings (weekspan ~ wingspan). Drawn for 16px first:
three dots instead of a real calendar face, solid wing silhouettes instead of outlines, short
binding stubs. A first pass put small wings beside tall rings and read as a beetle at tab size —
rings as antennae, wings as horns — so the wings moved down to the body's waist and grew.

Colours are literal, not tokens: a favicon is chrome drawn outside the page and cannot see CSS
custom properties.

**It silently failed to parse at first.** The explanatory comment contained `--ws-active-bg`,
and a double hyphen is illegal inside an XML comment — the whole file rendered as a broken
image with no error anywhere except an XML parser message. Token names in that comment are now
written without their leading dashes, and it says why.

Vite emits an SVG referenced from a `<link>` as a separate asset regardless of
`assetsInlineLimit`, which would have left the single-file build pointing at an `app.svg` that
does not travel with it. `build-singlefile.mjs` inlines it as base64 (percent-encoding breaks
on the `#` colour literals) and now **fails the build on any remaining sibling reference** —
that class of bug is silent otherwise: a missing icon, an unstyled page, no error.

## Sort-by-date button

`sortByDate` in weekspan-core, button in the ITEM header. Done items first by latest done mark,
then due items by soonest due mark, then unmarked in existing order. Recurring items are keyed
from the CURRENT WEEK only — a standing commitment has no meaningful all-time date, and
generated occurrences run to the horizon in both directions.

Two judgment calls the brief left open, both stated in the source: **ascending in both
buckets**, and **done keyed by its latest mark while due is keyed by its soonest** ("when did I
last finish this" and "when must I next act on this" are opposite ends of the same range).

Sorts within rank scopes, so children sort among siblings and nesting survives. Returns null
when already ordered, so a second press writes nothing.

*Flagged:* unlike a drag, this rewrites every rank in a scope it reorders. Inherent to sorting,
and the reason it is an explicit button rather than anything automatic.

## The "No project" bucket can be coloured

Its swatch was inert — `DividerRow` rendered a `<span>` for the null bucket and a `<button>` for
everything else, and `onPickColor` was typed `(projectId: string, …)`, so null had nowhere to go.

**Where the colour lives, and why it is not in the file.** Every real project carries
`colorToken` in the ledger. The unassigned bucket is the ABSENCE of a project, so there is no
`Project` record to hang a colour on and the only place a top-level colour could live is a new
field on `Weekspan`. That was rejected: `parse` calls `rejectUnknownKeys`, so a file carrying a
field an older client does not know about is REFUSED, not ignored. Adding one therefore means
bumping `SCHEMA_VERSION` — and `MIGRATIONS.md` is explicit that no migration tooling exists and
that a bump locks every older copy of the app out of the file. Since the app is distributed by
copying an HTML file between machines, older copies genuinely exist. Too steep a price for a
colour.

So it lives per-device in `localStorage`, beside the theme and the zoom level — the two other
display preferences the file deliberately does not carry. **Stated consequence: the choice does
not travel with the ledger.** If it should, that needs a schema version and a migration chain,
which is a different piece of work.

`loadNoProjectColor` validates against the live `PROJECT_COLOR_TOKENS` rather than trusting
storage: an unknown token would resolve to a CSS custom property that does not exist and paint
the bar transparent with no clue why. That also happens to close a CSS-injection route through
a hand-edited storage value.

The picker gained `allowNone`, because colourless is this bucket's default and the user has to
be able to get back to it. A real project always has a colour, so the option is absent there
rather than silently doing nothing.

### The picker was never positioned — pre-existing

Found while testing the above, and it affected real projects equally. `App` captured the click's
`x`/`y` into `colorPicker` state and then never passed them on; `.ws-colorpicker` had no
`position`, so the "small popover" laid out in normal document flow at the end of the shell,
`position: static` and stretched to the full viewport height, nowhere near the swatch that
opened it. Now `position: fixed` with the click coordinates, matching `CellMenu`, plus a clamp
so it cannot run off the right edge. Its width is computed from the swatch count rather than
measured — measuring would need a layout pass the first paint does not have.
