import { PROJECT_COLOR_TOKENS } from '@weekspan/weekspan-core'

/**
 * The colour of the "No project" bucket.
 *
 * Every real project carries its `colorToken` in the ledger file. This one
 * cannot: the unassigned bucket is the ABSENCE of a project, so there is no
 * `Project` record to hang a colour on, and the only place a top-level colour
 * could live is a new field on `Weekspan` itself.
 *
 * That was rejected deliberately. `parse` is strict — it calls
 * `rejectUnknownKeys`, so a file carrying a field an older client does not know
 * about is refused outright, not ignored. Adding one therefore means bumping
 * `SCHEMA_VERSION`, and `MIGRATIONS.md` is explicit that no migration tooling
 * exists yet and that a version bump locks every older copy of the app out of
 * the file ("A newer file must be refused, not downgraded"). Since the app is
 * distributed by copying an HTML file between machines, older copies genuinely
 * do exist. That is a steep price for a colour.
 *
 * So it lives per-device, alongside the theme and the zoom level — the two
 * other display preferences the file deliberately does not carry. The
 * consequence, stated plainly: this choice does NOT travel with the ledger.
 * Set it on each machine. If it should sync, it needs a schema version and a
 * migration chain, and that is a different piece of work.
 *
 * `null` means colourless, which is the historical behaviour and stays the
 * default.
 */

const STORAGE_KEY = 'weekspan.noProjectColor'

/** The stored value, or null for colourless. Unrecognized tokens read as null. */
export function loadNoProjectColor(storage?: Storage): string | null {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return null

  try {
    const raw = store.getItem(STORAGE_KEY)
    // Validate against the live ramp rather than trusting storage: a token from
    // a future build (or a hand-edited value) would resolve to a CSS custom
    // property that does not exist, painting the bar transparent with no clue why.
    return raw !== null && PROJECT_COLOR_TOKENS.includes(raw) ? raw : null
  } catch {
    return null
  }
}

/** Persist the choice. Pass null to go back to colourless. Never touches the ledger. */
export function saveNoProjectColor(token: string | null, storage?: Storage): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return

  try {
    if (token === null) store.removeItem(STORAGE_KEY)
    else store.setItem(STORAGE_KEY, token)
  } catch {
    // Storage unavailable/full — the choice simply won't persist.
  }
}
