/**
 * Edge auto-scroll for drags.
 *
 * Without this, dragging a row toward the top or bottom of the grid did nothing
 * until the pointer left the browser window entirely and the OS/native scroll
 * took over — far too late to be useful, and it made the row appear to come
 * unstuck from the cursor when you moved back in. The row was not actually
 * detached: the drag measures every row ONCE at pointerdown, in viewport
 * coordinates, so any scrolling in between left those measurements stale by the
 * scroll delta and the previewed index stopped tracking the pointer.
 *
 * Two fixes, and they belong together: start scrolling while the pointer is
 * still comfortably inside the container, and compensate the pointer position by
 * the scroll delta so the stale boxes still resolve to the right index (see
 * `useDragPreview` — it adds the delta to `pointerY` rather than re-measuring
 * every row on every frame, which is the same comparison and vastly cheaper).
 *
 * Dragging a MARK chip needs the identical thing on the x axis: the window is
 * several weeks wide and routinely wider than the viewport, so without it the
 * furthest day you could move a mark to is the last one that happens to be on
 * screen. Both axes share `axisDelta` — same ramp, same zone-halving guard —
 * with the two exported wrappers differing only in which pair of edges they
 * read.
 */

/**
 * How far from an edge auto-scroll begins. Deliberately generous: the grid's
 * sticky header rows eat the top ~58px of the scroll box, so a tight zone would
 * only ever trigger once the row was already hidden behind them.
 */
export const AUTOSCROLL_ZONE_PX = 72

/**
 * The horizontal zone is narrower because a day column is only 38px wide: a
 * 72px zone would be nearly two whole days of "already scrolling", making the
 * outermost visible days impossible to drop on.
 */
export const AUTOSCROLL_ZONE_X_PX = 40

/** Peak speed, in px per animation frame, reached at (and past) the edge. */
export const AUTOSCROLL_MAX_PX = 18

/**
 * Pixels to scroll this frame: negative up, positive down, 0 when the pointer is
 * clear of both zones.
 *
 * Speed ramps linearly from 0 at the zone boundary to `max` at the edge, then
 * holds at `max` beyond it — so easing toward an edge creeps, and shoving past
 * it runs at full speed without a discontinuity at the crossing. A constant
 * speed inside the zone is the obvious alternative and feels much worse: it
 * lurches the instant you enter, with no way to nudge by a row.
 */
export function autoScrollDelta(
  rect: { top: number; bottom: number },
  pointerY: number,
  zone: number = AUTOSCROLL_ZONE_PX,
  max: number = AUTOSCROLL_MAX_PX,
): number {
  return axisDelta(rect.top, rect.bottom, pointerY, zone, max)
}

/**
 * The same, on the x axis, for a mark drag.
 *
 * `rect.left` is deliberately the caller's choice rather than the scroll box's
 * own left edge: the frozen item column is `position: sticky` and OVERLAYS the
 * first ~360px of that box, so a zone measured from the true edge would sit
 * underneath it — scrolling would begin while the pointer was over a title,
 * nowhere near a day. `useDragPreview` passes the right edge of the frozen
 * column, measured from the DOM, so the zone starts where the days do.
 */
export function autoScrollDeltaX(
  rect: { left: number; right: number },
  pointerX: number,
  zone: number = AUTOSCROLL_ZONE_X_PX,
  max: number = AUTOSCROLL_MAX_PX,
): number {
  return axisDelta(rect.left, rect.right, pointerX, zone, max)
}

/** Negative toward `start`, positive toward `end`, 0 when clear of both zones. */
function axisDelta(
  start: number,
  end: number,
  pointer: number,
  zone: number,
  max: number,
): number {
  // A container shorter than two zones would have them overlap, and a pointer in
  // the middle would satisfy both. Halving keeps them disjoint and meeting in
  // the centre, which degrades sensibly instead of picking a direction at random.
  const extent = end - start
  const effective = Math.min(zone, extent / 2)
  if (effective <= 0) return 0

  const beforeDepth = start + effective - pointer
  if (beforeDepth > 0) return -ramp(beforeDepth, effective, max)

  const afterDepth = pointer - (end - effective)
  if (afterDepth > 0) return ramp(afterDepth, effective, max)

  return 0
}

function ramp(depth: number, zone: number, max: number): number {
  return max * Math.min(1, depth / zone)
}
