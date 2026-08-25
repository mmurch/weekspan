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
 */

/**
 * How far from an edge auto-scroll begins. Deliberately generous: the grid's
 * sticky header rows eat the top ~58px of the scroll box, so a tight zone would
 * only ever trigger once the row was already hidden behind them.
 */
export const AUTOSCROLL_ZONE_PX = 72

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
  // A container shorter than two zones would have them overlap, and a pointer in
  // the middle would satisfy both. Halving keeps them disjoint and meeting in
  // the centre, which degrades sensibly instead of picking a direction at random.
  const height = rect.bottom - rect.top
  const effective = Math.min(zone, height / 2)
  if (effective <= 0) return 0

  const aboveDepth = rect.top + effective - pointerY
  if (aboveDepth > 0) return -ramp(aboveDepth, effective, max)

  const belowDepth = pointerY - (rect.bottom - effective)
  if (belowDepth > 0) return ramp(belowDepth, effective, max)

  return 0
}

function ramp(depth: number, zone: number, max: number): number {
  return max * Math.min(1, depth / zone)
}
