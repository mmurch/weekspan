/**
 * Reading a link out of a paste.
 *
 * The title of a Google Doc cannot be fetched (see `links.ts` in
 * weekspan-core for the three independent reasons), but it is often sitting
 * right there in the clipboard already. A copy carries several FLAVOURS, and
 * while `text/plain` is just the URL, `text/html` frequently contains the
 * anchor the user copied — `<a href="…">The Real Title</a>`. Copying a link
 * from inside a Google Doc, from Gmail, from Slack, or a Docs smart chip all
 * produce that. Copying the bare URL out of the browser address bar does not,
 * and nothing can change that: the address bar has no title to give.
 *
 * So this resolves a title when one was genuinely provided and reports failure
 * honestly otherwise, leaving the caller to fall back to the URL's kind label
 * and a rename. It never invents one.
 *
 * `titleFromClipboardHtml` parses with a narrow regex rather than `DOMParser`
 * on purpose: this workspace has no jsdom, so a `DOMParser` version could not
 * be unit-tested at all, and an untested clipboard parser is exactly the kind
 * of thing that silently writes garbage into the ledger. The job is small and
 * well-bounded — find anchors, read href and inner text — which is the one
 * shape regex-over-HTML is defensible for.
 */



const ANCHOR_RE = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi

/** Minimal entity decoding — what actually shows up in clipboard anchor text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Ampersand LAST, so "&amp;lt;" decodes to "&lt;" and not to "<".
    .replace(/&amp;/g, '&')
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Two URLs naming the same document.
 *
 * The `text/plain` and `text/html` flavours of one copy routinely differ in
 * trailing slash, `?usp=sharing`, or `/edit` vs `/view` — matching on the raw
 * string would reject a perfectly good title. For a Google URL the document id
 * is the stable part, so compare on origin plus id; otherwise fall back to
 * origin plus path.
 */
function sameTarget(a: string, b: string): boolean {
  const key = (raw: string): string | null => {
    try {
      const u = new URL(raw)
      const id = u.pathname.match(/\/d\/(?:e\/)?([^/]+)/)?.[1]
      return `${u.origin}${id ? `/d/${id}` : u.pathname.replace(/\/+$/, '')}`
    } catch {
      return null
    }
  }
  const ka = key(a)
  return ka !== null && ka === key(b)
}

/**
 * The title the clipboard's HTML flavour gives for `url`, or `null`.
 *
 * Returns null rather than a bad guess when:
 *   - there is no HTML flavour, or no anchor in it;
 *   - no anchor points at the URL that was actually pasted (the flavour can
 *     describe a whole copied paragraph containing several links);
 *   - the anchor's text is just the URL again, which is what a plain-text
 *     autolinker produces and carries no information at all.
 */
export function titleFromClipboardHtml(html: string | null, url: string): string | null {
  if (!html) return null

  for (const m of html.matchAll(ANCHOR_RE)) {
    const href = decodeEntities(m[2] ?? m[3] ?? '')
    if (!sameTarget(href, url)) continue

    const text = stripTags(m[4] ?? '')
    if (text === '') continue
    // An anchor whose text IS its href tells us nothing the URL did not.
    if (sameTarget(text, url) || text === url || text === href) continue
    return text
  }
  return null
}

/**
 * The single URL in `text`, or `null` if it is not a bare link.
 *
 * Deliberately strict: the whole trimmed paste must be ONE http(s) URL. This
 * is a paste handler that takes the text away and turns it into a chip, so
 * "the user pasted a link" has to be unambiguous — pasting a sentence that
 * happens to mention a URL must paste the sentence, unchanged.
 */
export function urlFromPaste(text: string | null): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return null

  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
}

/**
 * What to insert for a paste, when it should differ from what the browser
 * would insert anyway — otherwise `null`, meaning "let the ordinary paste
 * happen".
 *
 * A link lives in the item's text at the spot it was pasted, so the ordinary
 * paste is already right for a bare URL: the text gets the URL, and the
 * renderer draws it as an icon there. The one case worth intervening in is a
 * clipboard that ALSO carries a name for the link — copying from inside a
 * Doc, from Gmail or from Slack — where `[name](url)` preserves it.
 *
 * Returning `null` for everything else is deliberate rather than lazy: a
 * native paste keeps the browser's own undo stack for the text field intact,
 * which a programmatic insert does not.
 */
export function markdownForPaste(data: DataTransfer | null): string | null {
  const url = urlFromPaste(data?.getData('text/plain') ?? null)
  if (url === null) return null

  const title = titleFromClipboardHtml(data?.getData('text/html') ?? null, url)
  if (title === null) return null

  // `[` and `]` would break out of the link's own name; a newline would break
  // the line. Neither can be escaped in this dialect, so they are removed.
  const safe = title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  return safe === '' ? null : `[${safe}](${url})`
}
