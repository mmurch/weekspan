# Google Drive as the source of truth, without Drive for Desktop

**Status: design only. Nothing here is implemented.**

## Bottom line

There is no obvious, low-disruption solution. Every path that keeps a Drive-hosted ledger
working costs either an install you said you don't have, or a real piece of software with OAuth
in it. Per your instruction, nothing was built.

The least-bad option by a wide margin is **installing Google Drive for Desktop** and pointing
the app at a path inside it. If that is genuinely unavailable on the work machine — blocked by
IT rather than merely not-installed-yet — the next viable option is a small sync daemon, which
is a real project (roughly a day, plus a Google Cloud OAuth client you have to be allowed to
create). Everything else is worse than it looks.

Read the "What you already have" section before deciding. The answer is shaped by it.

## What you already have

This matters more than any Drive-specific design, so it goes first.

The app is already built to survive a file changing underneath it:

- `useWeekspan` polls the file every **2 seconds** (`POLL_MS`) and reloads when the content
  changes on disk.
- `FileSystemStore.write()` **never trusts `lastModified`**. It re-reads the file and compares
  content against the baseline it last saw. If the content moved, it runs
  `merge(base, ours, theirs)` — `weekspan-core`'s semantic three-way merge, which reconciles at
  item and cell granularity — and writes the merged result rather than clobbering.
- The UI already surfaces the outcome ("Another writer changed this file; changes were merged",
  plus a conflict count).

The consequence is the important part:

> **The app does not need to know what Drive is.** Anything that keeps the local file in step
> with Drive gets sync, change detection, and conflict resolution for free.

So this is not a question about the app. It is a question about what moves bytes between one
local path and one Drive file. ARCHITECTURE.md already states this as a deliberate position —
"Sync is delegated to whatever file-sync the user already runs... One local-filesystem adapter
covers every provider" — and nothing found here argues against it.

## Why the browser cannot talk to Drive directly

The tempting idea is to skip the filesystem and have the app read and write Drive over the API.
It does not work, for a structural reason rather than a fixable one.

The app ships as a **single HTML file you open from `file://`**. A `file://` page has a **null
origin**. Google's OAuth 2.0 requires every JavaScript origin and redirect URI to be registered
in advance, and `null` / `file://` cannot be registered. There is no flag, no console setting,
and no library that changes this — it is the security property the restriction exists to
provide.

Workarounds, and what each actually costs:

- **Host the page over HTTPS** (GitHub Pages, an internal host). OAuth then works — but so does
  the File System Access API, which needs HTTPS too and is already implemented and tested. You
  would be taking on OAuth, token storage and refresh, Drive API error handling and quota, in
  order to replace something that already works. And hosting the page is itself the disruption
  you were trying to avoid on a work machine.
- **A browser extension** — its own origin, so OAuth works. But now you are distributing and
  maintaining an extension on a machine whose extension policy you do not control.
- **Device-code flow** — avoids the redirect URI problem, but the resulting token still has to
  be used from a page that can reach `googleapis.com` with CORS, and it puts a long-lived
  refresh token in browser storage on a work machine. Not a good trade.

**Verify before acting on this:** the null-origin restriction is well established and I am
confident in it, but I did not sit down and try to register a `file://` origin in a Google
Cloud console to watch it fail. If someone wants to build the browser-direct version anyway,
that ten-minute experiment is the thing to do first, because it kills the idea cheaply.

## The options

### 1. Google Drive for Desktop — recommended

Install it, put the ledger at `~/Google Drive/My Drive/work.weekspan.json`, point the app there.

- **App changes: none.** This is exactly the case the architecture was designed for.
- Drive Desktop syncs continuously; the 2-second poll notices within a tick and merges.
- Handles offline, resumption, and file locking as a product problem someone else owns.

The honest caveats, since this is the recommendation:

- Drive Desktop syncs on **file close**, not on every byte. Two machines editing the same minute
  can still produce a Drive-side conflict, which Drive resolves by keeping both as
  `file.weekspan.json` and `file (1).weekspan.json` rather than merging. The app never sees the
  second file and cannot merge it. **This is the real risk, and it is not eliminated by any
  option below** — see "The conflict problem" .
- It is an install on a work machine. You said you don't have it; whether that is "haven't"
  or "can't" decides this whole document.

### 2. A local sync daemon — the real alternative

A small Node process (natural home: a `weekspan drive-sync` subcommand) that owns one job —
keep `local.weekspan.json` and one Drive file in step:

1. Poll Drive for the file's `modifiedTime` / `md5Checksum`.
2. On remote change, download and write locally. The app's existing poll picks it up and merges.
3. On local change, upload.
4. Keep the **last-synced content** on disk as the merge base, so a genuine two-sided change can
   be resolved with `merge(lastSynced, local, remote)` rather than a coin flip.

Why this is genuinely attractive: step 4 is the piece the architecture is *already built for*.
`merge()` takes exactly `(base, ours, theirs)`, and a sync daemon is the one component that
naturally knows what the base is. It would give better conflict behaviour than Drive Desktop,
because it merges semantically where Drive forks the file.

Why it is still not "obvious and low-disruption":

- Needs a Google Cloud project and an OAuth client you are permitted to create. On a corporate
  Workspace tenant, that may need admin approval — a bigger ask than installing Drive Desktop.
- Refresh tokens have to live somewhere on disk, with sane permissions.
- It is a background process someone has to remember to run, and to notice when it dies.
- It is new code on the critical path of your data. Everything the app currently guarantees
  about not losing writes is tested; this would not be, on day one.

### 3. Manual export / import — not recommended

Download from Drive before working, upload after.

Cheap to build and genuinely awful to live with: no merge base, so any forgotten step silently
discards a day. The app's whole no-clobber design is defeated by a workflow that clobbers by
hand. Worth naming only to rule it out.

### 4. Two ledgers, deliberately — the option worth considering

Do not sync at all. Keep `work.weekspan.json` on the work machine and `personal.weekspan.json`
on this one.

This is not a cop-out; the architecture explicitly anticipates it ("A client mounts N weekspan
paths; the work machine can mount work + personal while the home machine mounts personal
only"). If the work tasks and personal tasks are genuinely different lists, the sync problem
disappears rather than being solved, at zero cost and zero risk.

**The question to answer before building anything: do you actually need the same ledger in two
places, or two ledgers on two machines?** If it is the latter, stop here.

## The conflict problem

Worth stating separately, because it survives every option above.

Two machines with the same ledger and no continuous sync will diverge. `merge()` handles this
well *when it is given a correct base*. The base is what makes it work, and each option supplies
a different quality of base:

| Approach | Merge base | Result on a two-sided edit |
| --- | --- | --- |
| Drive Desktop | none at the Drive layer | Drive forks the file; app never sees the second copy |
| Sync daemon | last-synced content | true three-way merge, item and cell granularity |
| Manual | none | last writer wins; the other day's work is gone |
| Two ledgers | n/a | no conflict possible |

Note what this says: the daemon is the only option that makes conflicts *better* than the status
quo, and the recommended option (Drive Desktop) does not. That is an argument for the daemon on
correctness — and against it on everything else.

## Recommendation

1. **Find out whether Drive for Desktop is installable.** It collapses this to zero code. It is
   one question to IT, and it should be asked before any of the below.
2. **Decide whether you need one ledger or two.** If two ledgers work, take option 4 and close
   this document.
3. **Only if both fail:** build the sync daemon (option 2). Scope it as its own project with its
   own tests, not as a feature bolted onto the CLI.
4. **Do not build the browser-direct Drive integration.** The `file://` origin problem makes it
   a rewrite of the deployment model, not a feature.

## What I would need to proceed

- Whether Drive for Desktop is *unavailable* or merely *not installed*.
- Whether you can create an OAuth client in your work Google Cloud tenant.
- Whether work and personal are one list or two.
- Whether the work machine can run a background process at login.
