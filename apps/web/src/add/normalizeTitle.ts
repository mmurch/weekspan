/**
 * Collapse a title down to single spaces between words, with no leading or
 * trailing whitespace.
 *
 * `parseCapture` already builds `Capture.title` by splitting on `/\S+/g` and
 * rejoining with single spaces, so in practice a `Capture.title` is already
 * normalized this way (a newline in the typed text is just whitespace to
 * that split, same as a run of plain spaces). This function exists as an
 * explicit, testable safety net applied right before a title is submitted —
 * cheap, idempotent, and it means the submit path never depends on that
 * parser detail holding forever.
 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ')
}
