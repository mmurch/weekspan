import './HoverSeam.css'

/**
 * The hover seam — design #3c-A: "hovering the gap between two rows reveals a
 * 1px line with a 15px round + at its left end. Click inserts a row there;
 * the new item takes the rank midway between its neighbors and nothing else
 * moves."
 *
 * Presentational only: no store access. `afterId`/`beforeId` name the two
 * rows this seam sits between (either may be `null` at the very top/bottom of
 * the list); `onInsert` is called with both, unchanged, for the caller to
 * turn into an `insertItem({ afterId, beforeId, ... })` call.
 */

export interface HoverSeamProps {
  /** Id of the row immediately above this seam, or null if this is the top seam. */
  afterId: string | null
  /** Id of the row immediately below this seam, or null if this is the bottom seam. */
  beforeId: string | null
  onInsert: (afterId: string | null, beforeId: string | null) => void
}

export function HoverSeam({ afterId, beforeId, onInsert }: HoverSeamProps): JSX.Element {
  return (
    <div className="ws-seam" data-after-id={afterId ?? ''} data-before-id={beforeId ?? ''}>
      <button
        type="button"
        className="ws-seam-btn"
        aria-label="Insert item here"
        onClick={() => onInsert(afterId, beforeId)}
      >
        <span className="ws-seam-line" aria-hidden="true" />
        <span className="ws-seam-plus" aria-hidden="true">
          +
        </span>
      </button>
    </div>
  )
}
