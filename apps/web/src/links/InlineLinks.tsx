import type { ReactNode } from 'react'
import { classifyUrl, parseTitleLinks } from '@weekspan/weekspan-core'
import { glyphFor } from './glyph.js'
import './InlineLinks.css'

/**
 * An item's text, with any link in it drawn as an icon exactly where it sits.
 *
 * The text IS the source of truth for both the link and its position (see
 * `parseTitleLinks` in weekspan-core), so this is a pure render of what the
 * title already says — there is no second list to keep in step, and retyping
 * the line cannot desynchronise anything.
 *
 * A link with no name renders as the icon ALONE. That is the common case, not
 * a degraded one: copying from a browser's address bar or a share dialog gives
 * a bare URL, and a Google URL does not contain the document's name anywhere,
 * so there is nothing to show but what kind of thing it is. Printing a
 * stand-in like "Google Doc" next to every icon said nothing the icon had not
 * already said, and made a row of links unreadable.
 */
export function InlineLinks({ text }: { text: string }): JSX.Element {
  const nodes: ReactNode[] = []

  parseTitleLinks(text).forEach((seg, i) => {
    if (seg.kind === 'text') {
      nodes.push(seg.text)
      return
    }
    const { kind } = classifyUrl(seg.url)
    nodes.push(
      <a
        key={`${i}-${seg.url}`}
        className={`ws-ilink ws-ilink--${kind ?? 'generic'}`}
        href={seg.url}
        target="_blank"
        rel="noopener noreferrer"
        // The row's own click opens the title editor; opening a link must not
        // also do that, or every visit leaves an editor open behind it.
        onClick={(e) => e.stopPropagation()}
        title={seg.title ?? seg.url}
      >
        <span className="ws-ilink-icon" aria-hidden="true">
          {glyphFor(kind)}
        </span>
        {seg.title !== undefined ? <span className="ws-ilink-name">{seg.title}</span> : null}
      </a>,
    )
  })

  return <>{nodes}</>
}
