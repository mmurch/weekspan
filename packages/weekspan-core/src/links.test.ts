import { describe, expect, it } from 'vitest'
import { createWeekspan } from './weekspan.js'
import { addLink, classifyUrl, removeLink, setLinkTitle } from './links.js'
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
