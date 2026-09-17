/**
 * One letter per Google product.
 *
 * Text and CSS rather than an image or an icon font — the design's rule for
 * the whole grid — and at 12px a letter on the product's own colour is more
 * legible than a shrunken logo. The colour is what you actually recognise.
 *
 * Shared by the inline icon (`InlineLinks`) and the older chip (`LinkChip`) so
 * a Doc cannot be blue in one place and something else in the other.
 */
export const LINK_GLYPH: Record<string, string> = {
  gdoc: 'D',
  gsheet: 'S',
  gslides: 'P',
  gform: 'F',
  gdrive: '▲',
}

/** The glyph for a kind, with a neutral dot for an unrecognised link. */
export function glyphFor(kind: string | undefined): string {
  return (kind !== undefined ? LINK_GLYPH[kind] : undefined) ?? '·'
}
