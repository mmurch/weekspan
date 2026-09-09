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
