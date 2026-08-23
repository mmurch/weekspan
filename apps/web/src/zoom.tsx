import { useEffect, useState } from 'react'

/**
 * Zoom — the whole-UI scale control.
 *
 * Implemented with the CSS `zoom` property rather than a font-size multiplier,
 * because the design's proportions are the point: a 38px day column, a 25px chip
 * and 12.5px type are a system, and scaling only the text would break the
 * relationships between them. `zoom` scales layout and type together, so every
 * size in the handoff stays correct relative to every other.
 *
 * Chrome-only, which this app already is.
 *
 * Per-device, stored in localStorage — like the theme, it must never reach the
 * weekspan file.
 */

const KEY = 'weekspan.zoom'
export const ZOOM_LEVELS = [0.9, 1, 1.1, 1.25, 1.5, 1.75] as const
export const DEFAULT_ZOOM = 1

export function loadZoom(storage: Storage | undefined = safeStorage()): number {
  try {
    const raw = storage?.getItem(KEY)
    const n = raw === null || raw === undefined ? NaN : Number(raw)
    return ZOOM_LEVELS.includes(n as (typeof ZOOM_LEVELS)[number]) ? n : DEFAULT_ZOOM
  } catch {
    return DEFAULT_ZOOM
  }
}

export function saveZoom(zoom: number, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, String(zoom))
  } catch {
    // A blocked or full storage must never break the UI.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

const RAIL = 46
const ITEM_COLUMN = 360
/** 5 weekdays x 38px + 2 weekend x 19px, plus the block's 1px side borders. */
const WEEK_BLOCK = 5 * 38 + 2 * 19 + 2

/**
 * How many week blocks fit across the viewport.
 *
 * `zoom` shrinks the effective CSS-pixel width, so it has to divide in here or a
 * zoomed-in grid would keep requesting weeks it has no room for.
 */
export function weeksThatFit(viewportWidth: number, zoom: number): number {
  const usable = viewportWidth / zoom - RAIL - ITEM_COLUMN
  return Math.max(4, Math.floor(usable / WEEK_BLOCK))
}

export function useFillWeeks(zoom: number): number {
  const [weeks, setWeeks] = useState(() =>
    weeksThatFit(typeof window === 'undefined' ? 1440 : window.innerWidth, zoom),
  )
  useEffect(() => {
    const update = (): void => setWeeks(weeksThatFit(window.innerWidth, zoom))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [zoom])
  return weeks
}

export function ZoomPicker({
  zoom,
  onZoom,
}: {
  zoom: number
  onZoom: (z: number) => void
}): JSX.Element {
  return (
    <label className="ws-zoom" title="Interface size">
      <span className="ws-zoom-glyph">A</span>
      <select
        className="ws-zoom-select"
        value={zoom}
        onChange={(e) => {
          const next = Number(e.target.value)
          saveZoom(next)
          onZoom(next)
        }}
      >
        {ZOOM_LEVELS.map((z) => (
          <option value={z} key={z}>
            {Math.round(z * 100)}%
          </option>
        ))}
      </select>
    </label>
  )
}
