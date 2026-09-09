/**
 * ⌘K quick-capture parser: free text -> { title, due?, tokens }.
 *
 * The day-word vocabulary (ISO dates, `today`/`tomorrow`/`yesterday`, weekday
 * names, `+3d`/`-1w` offsets) is `tryParseDateWord` from
 * `@weekspan/weekspan-core`, the same shared parser the CLI's `parseDateArg`
 * wraps — so an agent using the CLI and a person typing into quick-capture
 * never learn two different date languages.
 *
 * **Projects are deliberately NOT inferred from the text.** An earlier version
 * matched any word against project names (and unique prefixes) and silently
 * assigned the item to whatever it hit, stripping that word from the title.
 * That guessed wrong constantly — ordinary words are project-name prefixes —
 * and the only way to type a title containing a project's own name was to
 * fight the parser. The project is now an explicit opt-in the user ticks in
 * `QuickCapture`, defaulting to none; nothing typed into the text can change
 * it. Dates stay inferred: a day-word is unambiguous, self-evident from the
 * highlight, and has no equivalent "I meant that literally" failure.
 */

import type { IsoDate } from '@weekspan/weekspan-core'
import { tryParseDateWord } from '@weekspan/weekspan-core'

export interface Token {
  start: number
  end: number
  kind: 'due' | 'text'
  value: string
}

export interface Capture {
  title: string
  due?: IsoDate
  /**
   * Never set by `parseCapture` — it is the project the user explicitly
   * ticked in `QuickCapture`, carried on the same object purely so the
   * submit payload is one value. Absent means "no project", which is the
   * default for every new item.
   */
  projectId?: string
  tokens: Token[]
}

/**
 * Parse free text typed into quick-capture.
 *
 * Words are matched left to right. A word that parses as a day-word becomes a
 * `due` token (highlighted amber); if several appear, the LAST one wins the
 * resolved `due` date, but every match is still tokenized so each is
 * highlighted. Everything else is a `text` token and survives into `title`,
 * in original order, space-joined.
 *
 * `tokens` covers every word in `input`, not just the matched ones: the
 * quick-capture input mirrors `input` verbatim in an underlay div, and a
 * complete, non-overlapping token list (spans line up with `input` exactly)
 * is what lets that underlay wrap only the due spans in `<mark>` while
 * reproducing everything else byte-for-byte.
 */
export function parseCapture(input: string, today: IsoDate): Capture {
  const tokens: Token[] = []
  const titleWords: string[] = []
  let due: IsoDate | undefined

  for (const m of input.matchAll(/\S+/g)) {
    const value = m[0]
    const start = m.index ?? 0
    const end = start + value.length

    const asDue = tryParseDateWord(value, today)
    if (asDue !== undefined) {
      due = asDue
      tokens.push({ start, end, kind: 'due', value })
      continue
    }

    tokens.push({ start, end, kind: 'text', value })
    titleWords.push(value)
  }

  const capture: Capture = { title: titleWords.join(' '), tokens }
  if (due !== undefined) capture.due = due
  return capture
}
