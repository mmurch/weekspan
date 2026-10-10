/**
 * The shortcut legend, anchored to the bottom of the viewport rather than to the
 * end of the content — a reference you glance at, so it should not require
 * scrolling to the bottom of a long list to find.
 */
export function ShortcutBar({
  count,
  undoDepth = 0,
}: {
  count: number
  /**
   * Steps available to undo. The hint is dimmed at zero rather than hidden:
   * a shortcut that appears only once it works is a shortcut nobody discovers.
   */
  undoDepth?: number
}): JSX.Element {
  return (
    <div className="ws-foot">
      <span>D due</span>
      <span>V done</span>
      <span>X clear</span>
      <span>⌥↑↓ reorder</span>
      <span>⌥←→ move due</span>
      <span>N new</span>
      <span className={undoDepth === 0 ? 'ws-foot-dim' : ''}>⌘Z undo</span>
      <span className="ws-foot-spacer">{count} items</span>
      {/* Which build is this? Unanswerable otherwise — the app travels between
          machines as a copied file, and two builds look identical. */}
      <span className="ws-foot-build" title="build">{__WEEKSPAN_BUILD__}</span>
    </div>
  )
}
