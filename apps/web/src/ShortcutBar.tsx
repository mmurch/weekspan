/**
 * The shortcut legend, anchored to the bottom of the viewport rather than to the
 * end of the content — a reference you glance at, so it should not require
 * scrolling to the bottom of a long list to find.
 */
export function ShortcutBar({ count }: { count: number }): JSX.Element {
  return (
    <div className="ws-foot">
      <span>D due</span>
      <span>V done</span>
      <span>X clear</span>
      <span>⌥↑↓ reorder</span>
      <span>⌥←→ move due</span>
      <span>N new</span>
      <span className="ws-foot-spacer">{count} items</span>
    </div>
  )
}
