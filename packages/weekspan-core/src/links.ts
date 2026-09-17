/**
 * Link chips — the `links` array on an item.
 *
 * `Link.title` is described in `types.ts` as "resolved once on paste and cached
 * here so chips render offline". The resolution half is deliberately NOT here,
 * and cannot be: the app ships as a single HTML file opened over `file://`,
 * whose origin is `null`, so a cross-origin fetch is refused outright. Even
 * from an https origin it would not help — reading a private doc needs the
 * user's cookies, and Google answers `docs.google.com` with
 * `Access-Control-Allow-Origin: *`, which the CORS spec forbids combining with
 * credentials. An anonymous fetch does not fail loudly either; it returns a
 * page titled "Page not found", so a scraper would cache that string into the
 * ledger forever. See `docs/google-drive-sync.md` for the same wall, reached
 * from the sync side.
 *
 * What IS knowable without a network is the KIND, because a Google URL says
 * what it points at in its own path. That is `classifyUrl`, and it is the half
 * that makes a chip recognisable at a glance. The title comes from the
 * clipboard when the source app provided one, and from the user otherwise —
 * both handled in the web app, since both are UI concerns.
 *
 * WHERE A LINK LIVES: in the item's own text, at the position it was pasted.
 * `parseTitleLinks` is what turns that text into segments for rendering. Two
 * forms are recognised — a bare URL, and `[name](url)` for a link that has a
 * name — so the text stays the single source of truth for both the link and
 * its position. The alternative (a separate `links` array plus an offset) has
 * to keep two things in step through every edit of the title, and cannot
 * survive the user simply retyping the line.
 *
 * The older `Link[]` array on an item predates this and is no longer written.
 * It stays supported so ledgers that already have one still render.
 *
 * Every function here is pure and returns `null` for "nothing to write",
 * matching the `mutate(apply)` contract used by every other write path.
 */

import type { Item, Link, Weekspan } from './types.js'

/**
 * What a link points at. Stored in `Link.kind` and used only to pick an icon,
 * so an unrecognised URL simply has no kind rather than a wrong one.
 *
 * These are open strings rather than a closed union in the schema (`parse.ts`
 * accepts any string) so a ledger written by a newer build, which knows a kind
 * this one does not, still loads instead of failing validation.
 */
export const LINK_KINDS = ['gdoc', 'gsheet', 'gslides', 'gform', 'gdrive'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

export interface UrlClassification {
  /** Absent when the URL is not one we recognise — a plain link, no icon. */
  kind?: LinkKind
  /**
   * What to call it when nothing better is available: the product name for a
   * recognised Google URL ("Google Doc"), the bare hostname otherwise. Never
   * the full URL — a 90-character string is not a chip label.
   */
  label: string
}

/**
 * Classify a URL by its path alone. No network, no auth, no guessing.
 *
 * Google is unusually cooperative here: the product is the first path segment
 * on `docs.google.com`, so `/document/` vs `/spreadsheets/` vs `/presentation/`
 * is an exact, stable read rather than a heuristic.
 *
 * A malformed URL classifies as unrecognised rather than throwing — this is
 * called on whatever happened to be in the clipboard.
 */
export function classifyUrl(url: string): UrlClassification {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { label: 'Link' }
  }

  const host = parsed.hostname.toLowerCase()
  const segment = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase()

  if (host === 'docs.google.com') {
    if (segment === 'document') return { kind: 'gdoc', label: 'Google Doc' }
    if (segment === 'spreadsheets') return { kind: 'gsheet', label: 'Google Sheet' }
    if (segment === 'presentation') return { kind: 'gslides', label: 'Google Slides' }
    if (segment === 'forms') return { kind: 'gform', label: 'Google Form' }
    return { kind: 'gdrive', label: 'Google Drive' }
  }
  // Short links Google hands out from the share dialog.
  if (host === 'forms.gle') return { kind: 'gform', label: 'Google Form' }
  if (host === 'drive.google.com') return { kind: 'gdrive', label: 'Google Drive' }
  if (host === 'sheets.google.com') return { kind: 'gsheet', label: 'Google Sheet' }
  if (host === 'slides.google.com') return { kind: 'gslides', label: 'Google Slides' }

  // `www.` is noise in an 11px chip; nothing else about the host is.
  return { label: host.replace(/^www\./, '') || 'Link' }
}

function withItem(weekspan: Weekspan, next: Item): Weekspan {
  return { ...weekspan, items: weekspan.items.map((i) => (i.id === next.id ? next : i)) }
}

function findItem(weekspan: Weekspan, itemId: string): Item | undefined {
  return weekspan.items.find((i) => i.id === itemId)
}

/**
 * Attach `link` to `itemId`.
 *
 * URL is the identity — that is not a choice made here, it is what
 * `merge.ts`'s `mergeLinks` already keys on, so anything else would let two
 * devices disagree about whether they hold the same link. Adding a URL the
 * item already has is therefore a no-op rather than a duplicate chip.
 */
export function addLink(weekspan: Weekspan, itemId: string, link: Link): Weekspan | null {
  const item = findItem(weekspan, itemId)
  if (!item) return null

  const url = link.url.trim()
  if (url === '') return null

  const links = item.links ?? []
  if (links.some((l) => l.url === url)) return null

  const next: Link = {
    url,
    title: link.title.trim(),
    ...(link.kind !== undefined ? { kind: link.kind } : {}),
  }
  return withItem(weekspan, { ...item, links: [...links, next] })
}

/** Drop the link with this URL. A no-op when the item does not have it. */
export function removeLink(weekspan: Weekspan, itemId: string, url: string): Weekspan | null {
  const item = findItem(weekspan, itemId)
  if (!item?.links?.some((l) => l.url === url)) return null

  const links = item.links.filter((l) => l.url !== url)
  const next: Item = { ...item }
  // An empty array and an absent key serialize differently; the absent key is
  // what an item with no links has always looked like, so keep it that way.
  if (links.length > 0) next.links = links
  else delete next.links
  return withItem(weekspan, next)
}

/**
 * Rename a link. This is the fallback for every URL whose title the clipboard
 * did not carry, so it is a first-class path rather than a repair tool.
 *
 * A blank title is refused rather than stored: a chip with no label is
 * unreadable, and the URL is still there to derive one from.
 */
export function setLinkTitle(
  weekspan: Weekspan,
  itemId: string,
  url: string,
  title: string,
): Weekspan | null {
  const item = findItem(weekspan, itemId)
  if (!item?.links) return null

  const trimmed = title.trim()
  if (trimmed === '') return null

  const existing = item.links.find((l) => l.url === url)
  if (!existing || existing.title === trimmed) return null

  const links = item.links.map((l) => (l.url === url ? { ...l, title: trimmed } : l))
  return withItem(weekspan, { ...item, links })
}

/** One piece of an item's text: literal text, or a link occupying that spot. */
export type TitleSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; url: string; title?: string }

/**
 * `[name](url)` or a bare http(s) URL. Markdown is tried first so the URL
 * inside one is never also matched as a bare URL.
 */
const LINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g

/**
 * Trailing punctuation a sentence puts after a URL but which is not part of
 * it: "see https://x.com/a, then..." must not linkify the comma. A closing
 * bracket is included, and this is why a bare URL that genuinely ends in one
 * is the case to name a link for instead.
 */
const TRAILING = /[.,;:!?'")\]}]+$/

/**
 * Split `text` into segments for rendering.
 *
 * Always returns the whole input: concatenating every segment's source text
 * reproduces `text` exactly, which is what lets the renderer draw an icon in
 * place while leaving everything around it untouched. A link with an empty or
 * whitespace-only name has no `title` — it renders as the icon alone, which is
 * the normal case, since copying a URL from a browser's address bar or a share
 * dialog carries no title anywhere in it.
 */
export function parseTitleLinks(text: string): TitleSegment[] {
  const out: TitleSegment[] = []
  let cursor = 0

  const pushText = (value: string): void => {
    if (value === '') return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += value
    else out.push({ kind: 'text', text: value })
  }

  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0
    pushText(text.slice(cursor, start))

    if (m[2] !== undefined) {
      const title = (m[1] ?? '').trim()
      out.push({ kind: 'link', url: m[2], ...(title !== '' ? { title } : {}) })
      cursor = start + m[0].length
      continue
    }

    // Bare URL: hand back any trailing sentence punctuation as text.
    const raw = m[3] ?? ''
    const trimmed = raw.replace(TRAILING, '')
    if (trimmed === '') {
      pushText(raw)
    } else {
      out.push({ kind: 'link', url: trimmed })
      pushText(raw.slice(trimmed.length))
    }
    cursor = start + m[0].length
  }

  pushText(text.slice(cursor))
  return out
}

/**
 * `text` with every link reduced to its name, or dropped when it has none.
 *
 * For the places that need words rather than markup: a tooltip, or the
 * "Deleted ..." message naming an item the user just blanked. A raw
 * `[spec](https://…/d/1AbC…)` in either reads as a bug.
 */
export function titlePlainText(text: string): string {
  return parseTitleLinks(text)
    .map((seg) => (seg.kind === 'text' ? seg.text : (seg.title ?? '')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
