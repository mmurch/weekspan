import { describe, expect, it } from 'vitest'
import { AUTOSCROLL_MAX_PX, AUTOSCROLL_ZONE_PX, autoScrollDelta } from './autoscroll.js'

/** A roomy container: 800px tall, so neither zone is clamped by height. */
const rect = { top: 100, bottom: 900 }

describe('autoScrollDelta — the dead zone', () => {
  it('is zero in the middle', () => {
    expect(autoScrollDelta(rect, 500)).toBe(0)
  })

  it('is zero exactly at each zone boundary', () => {
    expect(autoScrollDelta(rect, rect.top + AUTOSCROLL_ZONE_PX)).toBe(0)
    expect(autoScrollDelta(rect, rect.bottom - AUTOSCROLL_ZONE_PX)).toBe(0)
  })

  it('covers most of a normal container — scrolling is the exception, not the default', () => {
    const dead = rect.bottom - rect.top - 2 * AUTOSCROLL_ZONE_PX
    expect(dead / (rect.bottom - rect.top)).toBeGreaterThan(0.8)
  })
})

describe('autoScrollDelta — direction', () => {
  it('scrolls up (negative) near the top', () => {
    expect(autoScrollDelta(rect, rect.top + 10)).toBeLessThan(0)
  })

  it('scrolls down (positive) near the bottom', () => {
    expect(autoScrollDelta(rect, rect.bottom - 10)).toBeGreaterThan(0)
  })
})

describe('autoScrollDelta — the ramp', () => {
  it('starts gently just inside the zone, so you can still nudge by one row', () => {
    // This is the whole complaint: scrolling used to begin only once the pointer
    // had left the window. It now begins well inside — but slowly.
    const justInside = autoScrollDelta(rect, rect.top + AUTOSCROLL_ZONE_PX - 1)
    expect(Math.abs(justInside)).toBeGreaterThan(0)
    expect(Math.abs(justInside)).toBeLessThan(1)
  })

  it('reaches full speed at the edge', () => {
    expect(autoScrollDelta(rect, rect.top)).toBe(-AUTOSCROLL_MAX_PX)
    expect(autoScrollDelta(rect, rect.bottom)).toBe(AUTOSCROLL_MAX_PX)
  })

  it('is monotonic — deeper into the zone is never slower', () => {
    let prev = 0
    for (let d = AUTOSCROLL_ZONE_PX; d >= 0; d--) {
      const speed = Math.abs(autoScrollDelta(rect, rect.top + d))
      expect(speed).toBeGreaterThanOrEqual(prev)
      prev = speed
    }
  })

  it('holds at max beyond the edge rather than jumping', () => {
    // Past the edge the pointer is outside the container entirely (dragging
    // toward the window chrome). Clamping avoids a discontinuity at the crossing.
    expect(autoScrollDelta(rect, rect.top - 50)).toBe(-AUTOSCROLL_MAX_PX)
    expect(autoScrollDelta(rect, rect.bottom + 500)).toBe(AUTOSCROLL_MAX_PX)
  })
})

describe('autoScrollDelta — short containers', () => {
  it('halves the zones rather than letting them overlap', () => {
    // 80px tall: two full 72px zones would overlap by 64px, and a pointer in the
    // middle would satisfy both. Zones must stay disjoint.
    const short = { top: 0, bottom: 80 }
    expect(autoScrollDelta(short, 40)).toBe(0) // the exact centre is neutral
    expect(autoScrollDelta(short, 5)).toBeLessThan(0)
    expect(autoScrollDelta(short, 75)).toBeGreaterThan(0)
  })

  it('never returns a direction that contradicts which half the pointer is in', () => {
    const short = { top: 0, bottom: 80 }
    for (let y = 0; y <= 80; y++) {
      const d = autoScrollDelta(short, y)
      if (y < 40) expect(d).toBeLessThanOrEqual(0)
      if (y > 40) expect(d).toBeGreaterThanOrEqual(0)
    }
  })

  it('degrades to zero for a collapsed container instead of dividing by zero', () => {
    expect(autoScrollDelta({ top: 50, bottom: 50 }, 50)).toBe(0)
    expect(Number.isFinite(autoScrollDelta({ top: 0, bottom: 0 }, 10))).toBe(true)
  })
})
