# Schema Migrations — Design Note

**Status: no migration tooling exists yet. `SCHEMA_VERSION` is 1 and always has been.**

This note exists so the contract below is not rediscovered the hard way when the first
breaking schema change lands. Read it BEFORE bumping `SCHEMA_VERSION`.

## Why this is more dangerous here than in a normal app

There is no server and no central database. The ledger file is truth, and copies of it live
on every machine the user syncs to, edited by clients that may be different versions of the
app — plus a CLI, plus whatever agent touched it last. There is no coordinated deploy that
upgrades everything at once.

So the file has to carry its own version honestly, and every reader has to act on it.

## The version contract

1. **`version` describes the SHAPE OF THE DATA IN THE FILE.** It is not a build number, not
   an app version, and not "the newest version this client knows about."

2. **`serialize` must never invent it.** It writes `ledger.version` verbatim. A serializer
   that stamps the current constant will happily write `version: 2` onto v1-shaped data
   during any unrelated edit, and every future reader will trust that number. The migration
   that should have run never ran, and nothing anywhere records that it didn't.
   *(This was the original implementation. See task #12.)*

3. **Only a migration may raise a file's version**, and only as the direct result of
   transforming the data. Version bump and data transform are one atomic step or the
   invariant is already broken.

4. **A newer file must be refused, not downgraded.** `parse` already throws
   `FutureVersionError` when `version > SCHEMA_VERSION`. Keep that. An old tab meeting a file
   from a newer client must stop, not silently drop the fields it doesn't understand — that
   would write the loss back to disk on the next save and destroy data on every synced device.

5. **Archive files carry versions too** (`ArchiveFile.version`) and are written once and then
   left alone for years. They will drift further behind than the working ledger ever does, so
   migrations must handle archives, and reading an old archive must not require migrating it
   in place.

## Shape the pipeline should take

```
read file → parse (returns the file's own version)
          → migrate(ledger)  // v1→v2→v3…, each step pure, bumping version as it transforms
          → app works on current-shape data
          → serialize (writes whatever version the data now genuinely is)
```

Migrations should be a chain of pure `(Ledger) => Ledger` steps keyed by source version, not
one big conditional. That way each step is independently testable, and a v1 file and a v3
file both arrive at current shape through the same code path.

## When you implement this, check these

- [ ] `serialize` writes `ledger.version`, never the constant (task #12)
- [ ] A helper stamps `SCHEMA_VERSION` for genuinely NEW ledgers, so there is one obvious
      correct way to construct a header
- [ ] Migration chain is pure functions, one per version step, individually tested
- [ ] Round-trip test per version: an unmigrated v(n) file survives parse → serialize
      unchanged, including its original version number
- [ ] `FutureVersionError` still refuses newer files, with a message telling the user to
      update the app rather than suggesting anything that would write
- [ ] Archive files migrate too, and reading one does not rewrite it in place
- [ ] **Back up the file before the first migration writes.** There is no server-side undo
      here — a bad migration propagates to every synced device within seconds.
- [ ] The CLI migrates on the same code path as the web app. Two implementations of a
      migration is two chances to disagree about what v2 means.

## Related

- `ARCHITECTURE.md` — "Format" section, on why `version` is load-bearing
- `IMPLEMENTATION-NOTES.md` — `serialize.ts` / `parse.ts` notes
