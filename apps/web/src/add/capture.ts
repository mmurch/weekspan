/**
 * ⌘K quick-capture parser: free text -> { title, due?, projectId?, tokens }.
 *
 * The day-word vocabulary (ISO dates, `today`/`tomorrow`/`yesterday`, weekday
 * names, `+3d`/`-1w` offsets) is deliberately identical to
 * `packages/cli/src/dates.ts`'s `parseDateArg`, so an agent using the CLI and a
 * person typing into quick-capture never learn two different date languages.
 * It is REIMPLEMENTED here rather than imported, per this package's boundary
 * (the web app depends on `@weekspan/weekspan-core`, not on the CLI package),
 * but every branch below mirrors `tryParseDateArg` one-for-one — keep them in
 * sync if that vocabulary ever changes. The one deliberate difference: capture
 * words are already whitespace-free by construction (they come from splitting
 * the input on whitespace), so the "reject internal whitespace" guard in the
 * original has no equivalent here.
 */

import type { IsoDate, Project } from '@weekspan/weekspan-core'
import { addDays, isValidIsoDate, weekday } from '@weekspan/weekspan-core'

export interface Token {
  start: number
  end: number
  kind: 'due' | 'project' | 'text'
  value: string
}

export interface Capture {
  title: string
  due?: IsoDate
  projectId?: string
  tokens: Token[]
}

const WEEKDAY_NAMES: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
}

const OFFSET_RE = /^([+-])(\d+)([dw])$/

/** Next date on-or-after `today` (inclusive) whose weekday matches `targetWeekday` (1=Mon..7=Sun). */
function nextWeekdayInclusive(today: IsoDate, targetWeekday: number): IsoDate {
  const delta = (targetWeekday - weekday(today) + 7) % 7
  return addDays(today, delta)
}

/** Mirrors `tryParseDateArg` from `packages/cli/src/dates.ts` — see file header. */
function tryParseDayWord(word: string, today: IsoDate): IsoDate | undefined {
  if (isValidIsoDate(word)) return word

  const lower = word.toLowerCase()
  if (lower === 'today') return today
  if (lower === 'tomorrow') return addDays(today, 1)
  if (lower === 'yesterday') return addDays(today, -1)
  if (lower in WEEKDAY_NAMES) return nextWeekdayInclusive(today, WEEKDAY_NAMES[lower]!)

  const m = OFFSET_RE.exec(word)
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    const n = Number(m[2])
    const unit = m[3]
    const days = unit === 'w' ? n * 7 : n
    return addDays(today, sign * days)
  }

  return undefined
}

/**
 * A project match for `word`, or `undefined` if none or ambiguous.
 *
 * Exact (case-insensitive) name match wins outright. Otherwise `word` must be
 * a case-insensitive prefix of EXACTLY ONE project's name — if it prefixes
 * more than one, that's an ambiguous prefix and must not match, per the
 * design ("leave the word as title text rather than guessing").
 */
function matchProject(word: string, projects: readonly Project[]): Project | undefined {
  const lower = word.toLowerCase()

  const exact = projects.find((p) => p.name.toLowerCase() === lower)
  if (exact) return exact

  const prefixed = projects.filter((p) => p.name.toLowerCase().startsWith(lower))
  return prefixed.length === 1 ? prefixed[0] : undefined
}

/**
 * Parse free text typed into quick-capture.
 *
 * Words are matched left to right. A word that parses as a day-word becomes a
 * `due` token (highlighted amber); if several appear, the LAST one wins the
 * resolved `due` date, but every match is still tokenized so each is
 * highlighted. A word that resolves to a project (name or unique prefix)
 * becomes a `project` token (highlighted blue) — only the FIRST such match is
 * taken, since only one project chip can be resolved. Everything else is a
 * `text` token and survives into `title`, in original order, space-joined.
 *
 * `tokens` covers every word in `input`, not just the matched ones: the
 * quick-capture input mirrors `input` verbatim in an underlay div, and a
 * complete, non-overlapping token list (spans line up with `input` exactly)
 * is what lets that underlay wrap only the due/project spans in `<mark>`
 * while reproducing everything else byte-for-byte.
 */
export function parseCapture(input: string, projects: readonly Project[], today: IsoDate): Capture {
  const tokens: Token[] = []
  const titleWords: string[] = []
  let due: IsoDate | undefined
  let projectId: string | undefined
  let projectClaimed = false

  for (const m of input.matchAll(/\S+/g)) {
    const value = m[0]
    const start = m.index ?? 0
    const end = start + value.length

    const asDue = tryParseDayWord(value, today)
    if (asDue !== undefined) {
      due = asDue
      tokens.push({ start, end, kind: 'due', value })
      continue
    }

    if (!projectClaimed) {
      const project = matchProject(value, projects)
      if (project) {
        projectId = project.id
        projectClaimed = true
        tokens.push({ start, end, kind: 'project', value })
        continue
      }
    }

    tokens.push({ start, end, kind: 'text', value })
    titleWords.push(value)
  }

  const capture: Capture = { title: titleWords.join(' '), tokens }
  if (due !== undefined) capture.due = due
  if (projectId !== undefined) capture.projectId = projectId
  return capture
}
