import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { PROJECT_COLOR_TOKENS } from '@weekspan/weekspan-core'
import './ProjectColorPicker.css'

/**
 * Small popover: six colour swatches in a row, the project's current colour
 * marked, click (or Enter) to choose. Purely presentational — no store
 * access, no knowledge of *which* project it's for. The caller supplies the
 * current token, gets the chosen token back via `onChange`, and decides what
 * "close" means (this component only ever calls `onClose`, never mutates
 * anything itself).
 *
 * Swatches paint from the live `--ws-bar-*` custom properties (see
 * `src/styles/tokens.css`), so the same component renders correctly in
 * Paper, Solarized dark and Warm dark without knowing which theme is active.
 *
 * A colour swatch alone has no accessible name, so each button carries an
 * explicit `aria-label` — "Project colour A" etc. — rather than relying on
 * hue words like "orange" or "green", which name a *different* colour in
 * each theme's ramp (see tokens.css's per-theme CVD notes) and would be
 * actively wrong for a Solarized user half the time.
 */

export interface ProjectColorPickerProps {
  /** The current colour token, e.g. `'barA'`, or null for no colour. */
  value: string | null
  /** Called with the newly chosen token, or null when "no colour" is chosen. */
  onChange: (token: string | null) => void
  /**
   * Offer a "no colour" swatch alongside the ramp. Set for the unassigned
   * bucket, whose colour is optional — colourless is its default, and the user
   * must be able to get back to it. A real project always has a colour, so the
   * option is absent there rather than silently doing nothing.
   */
  allowNone?: boolean
  /** Called to dismiss the popover — on Escape, on picking a swatch, or on an outside click. */
  onClose: () => void
  /** Viewport coordinates to anchor at, from the click that opened it. */
  position?: { x: number; y: number }
}

/** `barA` -> `bar-a`, matching the CSS custom-property naming (same convention as Grid.tsx / Rail.tsx). */
function kebab(token: string): string {
  return token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Keep the popover on screen. Swatches are 22px on a 6px gap inside 6px
 * padding, so its width is knowable without measuring — and measuring would
 * need a layout pass the first paint does not have.
 */
function clampX(x: number, count: number): number {
  const width = count * 22 + (count - 1) * 6 + 12
  const max = (typeof window === 'undefined' ? Infinity : window.innerWidth) - width - 8
  return Math.max(8, Math.min(x, max))
}

/** `barA` -> `A`, the letter used in both the visible row and each swatch's accessible name. */
function letterOf(token: string): string {
  return token.slice(-1).toUpperCase()
}

export function ProjectColorPicker({
  value,
  onChange,
  onClose,
  allowNone = false,
  position,
}: ProjectColorPickerProps): JSX.Element {
  // `null` is a real choice in this list, not a gap, so roving focus and the
  // arrow-key wraparound treat it exactly like any swatch.
  const choices: Array<string | null> = allowNone
    ? [...PROJECT_COLOR_TOKENS, null]
    : [...PROJECT_COLOR_TOKENS]
  const ref = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Roving focus starts on the currently-assigned colour so arrowing begins
  // from "where you are," not always from the first swatch.
  const initialIndex = Math.max(0, choices.indexOf(value))
  const [focusIndex, setFocusIndex] = useState(initialIndex)

  // Move actual DOM focus to match focusIndex whenever it changes via keyboard.
  useEffect(() => {
    buttonRefs.current[focusIndex]?.focus()
  }, [focusIndex])

  // Closes on any pointer-down outside the popover, same convention as
  // CellMenu.tsx. Capture phase so it beats a click handler underneath.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent): void {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [onClose])

  function pick(token: string | null): void {
    onChange(token)
    onClose()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        setFocusIndex((i) => (i + 1) % choices.length)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        setFocusIndex((i) => (i - 1 + choices.length) % choices.length)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(choices[focusIndex] ?? null)
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div
      ref={ref}
      className="ws-colorpicker"
      role="group"
      aria-label="Project colour"
      onKeyDown={handleKeyDown}
      style={position ? { left: clampX(position.x, choices.length), top: position.y } : undefined}
    >
      {choices.map((token, i) => {
        const selected = token === value
        return (
          <button
            key={token ?? '__none__'}
            ref={(el) => {
              buttonRefs.current[i] = el
            }}
            type="button"
            className={`ws-colorpicker-swatch${token === null ? ' ws-colorpicker-swatch--none' : ''}`}
            style={
              token === null
                ? undefined
                : { ['--ws-swatch-color' as string]: `var(--ws-${kebab(token)})` }
            }
            aria-label={
              token === null
                ? `No colour${selected ? ' (current)' : ''}`
                : `Project colour ${letterOf(token)}${selected ? ' (current)' : ''}`
            }
            aria-pressed={selected}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => pick(token)}
            onFocus={() => setFocusIndex(i)}
          >
            {selected && (
              <span className="ws-colorpicker-check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
