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

export interface FilterQuery {
  /** Lowercased, whitespace-split plain-text terms, ANDed at match time. */
  text: string
  project?: string
  state?: 'open' | 'done' | 'skipped'
  recurring?: boolean
}

/** A filtered row, tagged with whether it matched directly or is showing only as hierarchy context. */
export interface FilterRowVM extends RowVM {
  /**
   * True when this row is present ONLY to keep a matching parent/child
   * visible in context — it did not itself match the query. The UI is
   * expected to dim these (see `FilterField`'s consumer).
   */
  contextOnly: boolean
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
 * Filter `rows` by `query`, preserving rank order, and widening the result
 * so a hierarchy never gets torn apart into orphans:
 *
 *   - a matching PARENT (depth 0) pulls every one of its children (the run
 *     of depth-1 rows immediately following it) into the result as context;
 *   - a matching CHILD (depth 1) pulls its parent — the nearest PRECEDING
 *     depth-0 row — into the result as context.
 *
 * `RowVM` carries `depth`, not a parent id (the same constraint `Grid.tsx`
 * works around with `seamParentId`), so "parent" here means the same thing
 * it means there: adjacency by depth, not a stored relationship. That is
 * exact for the priority grid, where a child always immediately follows its
 * parent. In Project view a child can be sorted into a different project
 * bucket than its parent (parentId and projectId are independent axes —
 * see `projectView.ts`), so if the caller flattens a `ProjectVM`'s rows
 * bucket-by-bucket before calling this, cross-bucket parent/child context
 * cannot be recovered from `RowVM` alone; only same-bucket adjacency is
 * seen. This is a limitation of what `RowVM` exposes, not of this function.
 *
 * Context-only rows are tagged `contextOnly: true` (a row that both matches
 * directly AND would also have been pulled in as context is tagged
 * `contextOnly: false` — direct match wins).
 */
export function filterRows(
  rows: readonly RowVM[],
  query: FilterQuery,
  projectNameById: ReadonlyMap<string, string>,
): FilterRowVM[] {
  if (isEmptyQuery(query)) {
    return rows.map((row) => ({ ...row, contextOnly: false }))
  }

  const directHit = rows.map((row) => matchesFilter(row, query, projectNameById))
  const keep = [...directHit]

  // Matching parent -> pull in its run of children.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.depth === 0 && directHit[i]) {
      for (let j = i + 1; j < rows.length && rows[j]!.depth === 1; j++) {
        keep[j] = true
      }
    }
  }

  // Matching child -> pull in its nearest preceding depth-0 row.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.depth === 1 && directHit[i]) {
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j]!.depth === 0) {
          keep[j] = true
          break
        }
      }
    }
  }

  const out: FilterRowVM[] = []
  for (let i = 0; i < rows.length; i++) {
    if (!keep[i]) continue
    out.push({ ...rows[i]!, contextOnly: !directHit[i] })
  }
  return out
}
