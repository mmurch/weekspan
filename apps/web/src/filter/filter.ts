/**
 * Filtering for the `/ filter` box in the top bar.
 *
 * Pure and view-model-only: this module knows about `RowVM` (title, notes,
 * state, projectColorToken, recurring, depth) and nothing about React, the
 * store, or the domain layer directly — it borrows its structured-token
 * vocabulary from the CLI (`packages/cli/src/commands/list.ts`: `--project`,
 * `--open`/`--done`) rather than reinventing one, but the *values* that
 * vocabulary accepts differ out of necessity: `RowVM` never carries a raw
 * project id, so `project:` here
 * matches against a project's display NAME, substring, case-insensitively —
 * not the CLI's exact-id match. See `matchesFilter` below.
 */

import type { RowVM } from '../grid/viewModel.js'
import type { ProjectRow } from '../grid/projectView.js'

export interface FilterQuery {
  /** Lowercased, whitespace-split plain-text terms, ANDed at match time. */
  text: string
  project?: string
  state?: 'open' | 'done' | 'skipped'
  recurring?: boolean
}


function isEmptyQuery(query: FilterQuery): boolean {
  return (
    query.text === '' &&
    query.project === undefined &&
    query.state === undefined &&
    query.recurring === undefined
  )
}

/**
 * Parse the raw text typed into the filter box.
 *
 * Whitespace-separated tokens. A token shaped `key:value` is interpreted as
 * a structured filter when `key`/`value` are recognized (`project:`, or
 * `is:open` / `is:done` / `is:skipped` / `is:recurring`); every other token —
 * including an unrecognized `key:value`, e.g. a typo'd `is:opne` — falls
 * back to plain text. That fallback is deliberate: a typo silently emptying
 * the whole list would read as data loss, not as "no matches for this
 * token."
 *
 * Multiple terms (plain-text or structured) all AND together. An empty (or
 * whitespace-only) input parses to a query that matches everything.
 */
export function parseFilter(input: string): FilterQuery {
  const query: FilterQuery = { text: '' }
  const textTerms: string[] = []

  const tokens = input.trim().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    const colon = token.indexOf(':')
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : ''
    const value = colon > 0 ? token.slice(colon + 1) : ''

    if (key === 'project' && value !== '') {
      query.project = value
      continue
    }
    if (key === 'is' && value !== '') {
      const v = value.toLowerCase()
      if (v === 'open' || v === 'done' || v === 'skipped') {
        query.state = v
        continue
      }
      if (v === 'recurring') {
        query.recurring = true
        continue
      }
    }

    // Unknown key:value (or plain word) — treated as a plain-text term.
    textTerms.push(token.toLowerCase())
  }

  query.text = textTerms.join(' ')
  return query
}

/**
 * Whether a single row matches `query` on its own — no hierarchy context
 * applied. `filterRows` is what widens a match set to keep parents/children
 * visible; this function only answers "does THIS row match."
 */
export function matchesFilter(
  row: RowVM,
  query: FilterQuery,
  projectNameById: ReadonlyMap<string, string>,
): boolean {
  if (query.state !== undefined) {
    const wanted = query.state === 'done' ? 'finished' : query.state
    if (row.state !== wanted) return false
  }

  if (query.recurring !== undefined && row.recurring !== query.recurring) return false

  if (query.project !== undefined) {
    const name = row.projectId !== null ? projectNameById.get(row.projectId) : undefined
    if (name === undefined) return false
    if (!name.toLowerCase().includes(query.project.toLowerCase())) return false
  }

  if (query.text !== '') {
    const haystack = `${row.title} ${row.notes ?? ''}`.toLowerCase()
    const terms = query.text.split(' ').filter(Boolean)
    for (const term of terms) {
      if (!haystack.includes(term)) return false
    }
  }

  return true
}

/**
 * Filter `rows` by `query`, preserving rank order. ONLY rows that match are
 * returned — a filtered grid shows matches and nothing else.
 *
 * An earlier version widened the result to keep a match's parent or children
 * visible as context, tagging them `contextOnly` for the UI to dim. Nothing
 * ever consumed that flag, so those rows rendered identically to real matches:
 * typing a term left items on screen that plainly did not contain it, with no
 * way to tell which was which. Rather than wire up the dimming, the widening is
 * gone — "show me what matches" is what the box appears to promise, and a
 * filtered list is a lookup tool, not a place to read hierarchy.
 *
 * The cost, stated plainly: a matching child whose parent does not match still
 * renders at depth 1, so it keeps its indent with nothing above it. That reads
 * as a slightly indented row, not as a broken tree, and it beats showing a
 * parent the user did not search for.
 */
export function filterRows(
  rows: readonly RowVM[],
  query: FilterQuery,
  projectNameById: ReadonlyMap<string, string>,
): RowVM[] {
  if (isEmptyQuery(query)) return [...rows]
  return rows.filter((row) => matchesFilter(row, query, projectNameById))
}

/**
 * The Project-view equivalent: keep matching item rows, and keep a group
 * divider only when something under it survived.
 *
 * Without the second half, filtering Project view would leave a column of empty
 * group headers standing over nothing — the visual equivalent of the context
 * rows this module just stopped emitting. An empty group is not a match.
 *
 * Takes the ids to keep rather than re-running `matchesFilter`, so Priority and
 * Project view cannot disagree about what matched: both read the same set,
 * computed once from the same `RowVM[]`.
 */
export function filterProjectRows(
  rows: readonly ProjectRow[],
  keepIds: ReadonlySet<string>,
): ProjectRow[] {
  const out: ProjectRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.kind === 'item') {
      if (keepIds.has(row.row.id)) out.push(row)
      continue
    }
    // A divider survives only if some item before the NEXT divider does.
    let hasSurvivor = false
    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j]!
      if (next.kind === 'divider') break
      if (keepIds.has(next.row.id)) { hasSurvivor = true; break }
    }
    if (hasSurvivor) out.push(row)
  }
  return out
}
