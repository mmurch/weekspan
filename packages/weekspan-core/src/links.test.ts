import { describe, expect, it } from 'vitest'
import { createWeekspan } from './weekspan.js'
import {
  addLink,
  classifyUrl,
  parseTitleLinks,
  removeLink,
  setLinkTitle,
  titlePlainText,
} from './links.js'
import type { Weekspan } from './types.js'
import { rankSequence } from './rank.js'

describe('classifyUrl', () => {
  it.each([
    ['https://docs.google.com/document/d/abc123/edit', 'gdoc', 'Google Doc'],
    ['https://docs.google.com/spreadsheets/d/abc123/edit#gid=0', 'gsheet', 'Google Sheet'],
    ['https://docs.google.com/presentation/d/abc123/edit', 'gslides', 'Google Slides'],
    ['https://docs.google.com/forms/d/abc123/viewform', 'gform', 'Google Form'],
    ['https://forms.gle/abc123', 'gform', 'Google Form'],
    ['https://drive.google.com/file/d/abc123/view', 'gdrive', 'Google Drive'],
  ])('%s is a %s', (url, kind, label) => {
    expect(classifyUrl(url)).toEqual({ kind, label })
  })

  it('recognises the kind regardless of query, fragment or trailing path', () => {
    // A copied Docs URL routinely carries ?usp=sharing, #heading=..., /edit,
    // /preview or /mobilebasic. None of that changes what it points at.
    for (const tail of ['/edit', '/preview', '/mobilebasic', '?usp=sharing', '#heading=h.abc']) {
      expect(classifyUrl(`https://docs.google.com/document/d/abc123${tail}`).kind).toBe('gdoc')
    }
  })

  it('falls back to the bare hostname for anything unrecognised', () => {
    expect(classifyUrl('https://www.github.com/foo/bar')).toEqual({ label: 'github.com' })
    expect(classifyUrl('https://example.org/x')).toEqual({ label: 'example.org' })
  })

  it('treats an unknown docs.google.com product as Drive rather than guessing', () => {
    expect(classifyUrl('https://docs.google.com/somethingnew/d/abc').kind).toBe('gdrive')
  })

  it('does not throw on a malformed URL — this reads whatever was in the clipboard', () => {
    expect(classifyUrl('not a url at all')).toEqual({ label: 'Link' })
    expect(classifyUrl('')).toEqual({ label: 'Link' })
  })
})

const DOC = 'https://docs.google.com/document/d/abc123/edit'
const SHEET = 'https://docs.google.com/spreadsheets/d/xyz/edit'

function weekspanWith(ids: string[]): Weekspan {
  const ranks = rankSequence(ids.length)
  return createWeekspan({
    items: ids.map((id, i) => ({ id, title: id, rank: ranks[i]!, marks: {} })),
  })
}

describe('addLink', () => {
  it('attaches a link to the named item', () => {
    const w = weekspanWith(['a'])
    const next = addLink(w, 'a', { url: DOC, title: 'Tile spec', kind: 'gdoc' })!
    expect(next.items[0]!.links).toEqual([{ url: DOC, title: 'Tile spec', kind: 'gdoc' }])
    expect(w.items[0]!.links).toBeUndefined() // input untouched
  })

  it('appends rather than replacing, so an item can carry several', () => {
    let w = weekspanWith(['a'])
    w = addLink(w, 'a', { url: DOC, title: 'Spec' })!
    w = addLink(w, 'a', { url: SHEET, title: 'Costs' })!
    expect(w.items[0]!.links!.map((l) => l.url)).toEqual([DOC, SHEET])
  })

  it('refuses a duplicate URL — url is the identity mergeLinks keys on', () => {
    const w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Spec' })!
    expect(addLink(w, 'a', { url: DOC, title: 'A different name' })).toBeNull()
  })

  it('writes nothing for a missing item or a blank URL', () => {
    const w = weekspanWith(['a'])
    expect(addLink(w, 'ghost', { url: DOC, title: 'x' })).toBeNull()
    expect(addLink(w, 'a', { url: '   ', title: 'x' })).toBeNull()
  })

  it('omits kind entirely rather than storing undefined, so the file round-trips', () => {
    const next = addLink(weekspanWith(['a']), 'a', { url: 'https://x.com/', title: 'X' })!
    expect(Object.keys(next.items[0]!.links![0]!)).toEqual(['url', 'title'])
  })

  it('touches only the named item', () => {
    const w = weekspanWith(['a', 'b'])
    const next = addLink(w, 'a', { url: DOC, title: 'Spec' })!
    expect(next.items[1]).toBe(w.items[1])
  })
})

describe('removeLink', () => {
  it('drops the link with that URL', () => {
    let w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Spec' })!
    w = addLink(w, 'a', { url: SHEET, title: 'Costs' })!
    expect(removeLink(w, 'a', DOC)!.items[0]!.links!.map((l) => l.url)).toEqual([SHEET])
  })

  it('removes the key rather than leaving an empty array', () => {
    // An item with no links has always had no `links` key; an empty array would
    // be a new third state in the file for no reason.
    const w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Spec' })!
    expect('links' in removeLink(w, 'a', DOC)!.items[0]!).toBe(false)
  })

  it('writes nothing when the item has no such link', () => {
    const w = weekspanWith(['a'])
    expect(removeLink(w, 'a', DOC)).toBeNull()
    expect(removeLink(addLink(w, 'a', { url: DOC, title: 'x' })!, 'a', SHEET)).toBeNull()
  })
})

describe('setLinkTitle', () => {
  it('renames the link — the fallback path when the clipboard carried no title', () => {
    const w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Google Doc' })!
    expect(setLinkTitle(w, 'a', DOC, 'Tile spec')!.items[0]!.links![0]!.title).toBe('Tile spec')
  })

  it('trims, and refuses a blank title rather than storing an unreadable chip', () => {
    const w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Google Doc' })!
    expect(setLinkTitle(w, 'a', DOC, '  Tile spec  ')!.items[0]!.links![0]!.title).toBe('Tile spec')
    expect(setLinkTitle(w, 'a', DOC, '   ')).toBeNull()
  })

  it('writes nothing when the title is already that, or the link is absent', () => {
    const w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Spec' })!
    expect(setLinkTitle(w, 'a', DOC, 'Spec')).toBeNull()
    expect(setLinkTitle(w, 'a', SHEET, 'Costs')).toBeNull()
  })

  it('leaves kind alone', () => {
    const w = addLink(weekspanWith(['a']), 'a', { url: DOC, title: 'Google Doc', kind: 'gdoc' })!
    expect(setLinkTitle(w, 'a', DOC, 'Tile spec')!.items[0]!.links![0]!.kind).toBe('gdoc')
  })
})

describe('parseTitleLinks', () => {
  const DOC = 'https://docs.google.com/document/d/1AbC/edit'

  it('keeps a bare URL in position, with no title', () => {
    // The normal case: an address-bar or share-dialog copy carries no title
    // anywhere, so the link renders as the icon alone.
    expect(parseTitleLinks(`review ${DOC} before friday`)).toEqual([
      { kind: 'text', text: 'review ' },
      { kind: 'link', url: DOC },
      { kind: 'text', text: ' before friday' },
    ])
  })

  it('reads a name out of [name](url)', () => {
    expect(parseTitleLinks(`review [Tile spec](${DOC}) today`)).toEqual([
      { kind: 'text', text: 'review ' },
      { kind: 'link', url: DOC, title: 'Tile spec' },
      { kind: 'text', text: ' today' },
    ])
  })

  it('reproduces the input exactly when segments are concatenated', () => {
    // What lets the renderer draw an icon in place and leave the rest alone.
    for (const input of [
      'plain text only',
      `${DOC}`,
      `a ${DOC} b [n](${DOC}) c`,
      `trailing ${DOC}.`,
      '',
    ]) {
      const rebuilt = parseTitleLinks(input)
        .map((s) => (s.kind === 'text' ? s.text : s.title ? `[${s.title}](${s.url})` : s.url))
        .join('')
      expect(rebuilt).toBe(input)
    }
  })

  it('does not swallow sentence punctuation after a bare URL', () => {
    expect(parseTitleLinks(`see ${DOC}, then go`)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', url: DOC },
      { kind: 'text', text: ', then go' },
    ])
  })

  it('treats an empty name as no name rather than an empty label', () => {
    expect(parseTitleLinks(`[](${DOC})`)).toEqual([{ kind: 'link', url: DOC }])
    expect(parseTitleLinks(`[   ](${DOC})`)).toEqual([{ kind: 'link', url: DOC }])
  })

  it('does not match the URL inside a markdown link twice', () => {
    expect(parseTitleLinks(`[n](${DOC})`).filter((s) => s.kind === 'link')).toHaveLength(1)
  })

  it('ignores non-http schemes', () => {
    const text = 'run javascript:alert(1) and file:///etc/passwd'
    expect(parseTitleLinks(text)).toEqual([{ kind: 'text', text }])
  })

  it('handles several links in one line', () => {
    const b = 'https://example.com/b'
    expect(parseTitleLinks(`${DOC} and ${b}`).filter((s) => s.kind === 'link')).toEqual([
      { kind: 'link', url: DOC },
      { kind: 'link', url: b },
    ])
  })

  it('returns nothing for empty text', () => {
    expect(parseTitleLinks('')).toEqual([])
  })
})

describe('titlePlainText', () => {
  const DOC = 'https://docs.google.com/document/d/1AbC/edit'

  it('drops an unnamed link and keeps the words around it', () => {
    expect(titlePlainText(`review ${DOC} before friday`)).toBe('review before friday')
  })

  it('reduces a named link to its name', () => {
    expect(titlePlainText(`review [Tile spec](${DOC})`)).toBe('review Tile spec')
  })

  it('leaves ordinary text alone', () => {
    expect(titlePlainText('order tile samples')).toBe('order tile samples')
  })
})
