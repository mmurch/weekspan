import { markdownForPaste, titleFromClipboardHtml, urlFromPaste } from './clipboard.js'

const DOC = 'https://docs.google.com/document/d/1AbC_def-123/edit'

describe('urlFromPaste', () => {
  it('accepts a bare http(s) URL', () => {
    expect(urlFromPaste(DOC)).toBe(DOC)
    expect(urlFromPaste('http://example.com/x')).toBe('http://example.com/x')
  })

  it('tolerates surrounding whitespace, which a copy routinely picks up', () => {
    expect(urlFromPaste(`  ${DOC}\n`)).toBe(DOC)
  })

  it('refuses a sentence that merely contains a URL', () => {
    // The handler takes the pasted text AWAY and turns it into a chip, so this
    // has to be unambiguous — pasting prose must paste prose.
    expect(urlFromPaste(`see ${DOC} for details`)).toBeNull()
    expect(urlFromPaste(`${DOC} ${DOC}`)).toBeNull()
  })

  it('refuses non-http schemes and non-URLs', () => {
    expect(urlFromPaste('javascript:alert(1)')).toBeNull()
    expect(urlFromPaste('file:///etc/passwd')).toBeNull()
    expect(urlFromPaste('mailto:a@b.com')).toBeNull()
    expect(urlFromPaste('just some text')).toBeNull()
    expect(urlFromPaste('')).toBeNull()
    expect(urlFromPaste(null)).toBeNull()
  })
})

describe('titleFromClipboardHtml', () => {
  it('reads the title out of the anchor, which is what copying from a doc gives', () => {
    const html = `<meta charset="utf-8"><a href="${DOC}">Weymouth tile spec</a>`
    expect(titleFromClipboardHtml(html, DOC)).toBe('Weymouth tile spec')
  })

  it('matches the anchor even when the two flavours disagree about the tail', () => {
    // Real copies differ constantly: text/plain says /edit?usp=sharing while
    // the HTML flavour says /view. Same document id, so same document.
    const html = `<a href="https://docs.google.com/document/d/1AbC_def-123/view?usp=sharing">Tile spec</a>`
    expect(titleFromClipboardHtml(html, DOC)).toBe('Tile spec')
  })

  it('picks the anchor for the pasted URL out of a paragraph of several', () => {
    const html =
      `<p><a href="https://example.com/other">Something else</a> and ` +
      `<a href="${DOC}">The right one</a></p>`
    expect(titleFromClipboardHtml(html, DOC)).toBe('The right one')
  })

  it('strips nested markup and collapses whitespace', () => {
    const html = `<a href="${DOC}"><span style="x">Tile</span>  <b>spec</b>\n</a>`
    expect(titleFromClipboardHtml(html, DOC)).toBe('Tile spec')
  })

  it('decodes entities, ampersand last so &amp;lt; does not become <', () => {
    expect(titleFromClipboardHtml(`<a href="${DOC}">Q1 &amp; Q2 &quot;plan&quot;</a>`, DOC))
      .toBe('Q1 & Q2 "plan"')
    expect(titleFromClipboardHtml(`<a href="${DOC}">a &amp;lt; b</a>`, DOC)).toBe('a &lt; b')
  })

  it('handles single-quoted hrefs and extra attributes', () => {
    const html = `<a target="_blank" href='${DOC}' rel="noopener">Tile spec</a>`
    expect(titleFromClipboardHtml(html, DOC)).toBe('Tile spec')
  })

  it('returns null when the anchor text is just the URL again', () => {
    // What a plain-text autolinker produces. It carries no information, and
    // caching it would put a 60-character URL in an 11px chip.
    expect(titleFromClipboardHtml(`<a href="${DOC}">${DOC}</a>`, DOC)).toBeNull()
  })

  it('returns null when no anchor points at the pasted URL', () => {
    expect(titleFromClipboardHtml(`<a href="https://example.com/">Other</a>`, DOC)).toBeNull()
  })

  it('returns null for no HTML flavour, no anchor, or empty anchor text', () => {
    expect(titleFromClipboardHtml(null, DOC)).toBeNull()
    expect(titleFromClipboardHtml('', DOC)).toBeNull()
    expect(titleFromClipboardHtml('<p>no anchors here</p>', DOC)).toBeNull()
    expect(titleFromClipboardHtml(`<a href="${DOC}">   </a>`, DOC)).toBeNull()
  })
})

describe('markdownForPaste', () => {
  const DOC = 'https://docs.google.com/document/d/1AbC_def-123/edit'
  const data = (plain: string, html?: string): DataTransfer =>
    ({ getData: (t: string) => (t === 'text/html' ? (html ?? '') : plain) }) as DataTransfer

  it('wraps the URL with the name the clipboard carried', () => {
    expect(markdownForPaste(data(DOC, `<a href="${DOC}">Tile spec</a>`))).toBe(
      `[Tile spec](${DOC})`,
    )
  })

  it('returns null for a bare URL, so the ordinary paste happens', () => {
    // The normal case — an address-bar or share-dialog copy. The URL lands in
    // the text as-is and renders as an icon; a native paste also keeps the
    // field's own undo stack, which a programmatic insert would break.
    expect(markdownForPaste(data(DOC))).toBeNull()
  })

  it('returns null when the paste is not a bare URL at all', () => {
    expect(markdownForPaste(data('see the doc for details'))).toBeNull()
    expect(markdownForPaste(null)).toBeNull()
  })

  it('strips brackets and newlines that would break the link markup', () => {
    expect(markdownForPaste(data(DOC, `<a href="${DOC}">Q3 [draft]\nv2</a>`))).toBe(
      `[Q3 draft v2](${DOC})`,
    )
  })

  it('returns null when the name is only brackets, rather than emitting an empty one', () => {
    expect(markdownForPaste(data(DOC, `<a href="${DOC}">[]</a>`))).toBeNull()
  })
})
