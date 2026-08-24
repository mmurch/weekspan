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
  /** The project's current colour token, e.g. `'barA'`. */
  value: string
  /** Called with the newly chosen token when the user picks a swatch (click or Enter). */
  onChange: (token: string) => void
  /** Called to dismiss the popover — on Escape, on picking a swatch, or on an outside click. */
  onClose: () => void
}

/** `barA` -> `bar-a`, matching the CSS custom-property naming (same convention as Grid.tsx / Rail.tsx). */
function kebab(token: string): string {
  return token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/** `barA` -> `A`, the letter used in both the visible row and each swatch's accessible name. */
function letterOf(token: string): string {
  return token.slice(-1).toUpperCase()
}

export function ProjectColorPicker({ value, onChange, onClose }: ProjectColorPickerProps): JSX.Element {
  const tokens = PROJECT_COLOR_TOKENS
  const ref = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Roving focus starts on the currently-assigned colour so arrowing begins
  // from "where you are," not always from the first swatch.
  const initialIndex = Math.max(0, tokens.indexOf(value))
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

  function pick(token: string): void {
    onChange(token)
    onClose()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        setFocusIndex((i) => (i + 1) % tokens.length)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        setFocusIndex((i) => (i - 1 + tokens.length) % tokens.length)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(tokens[focusIndex]!)
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div ref={ref} className="ws-colorpicker" role="group" aria-label="Project colour" onKeyDown={handleKeyDown}>
      {tokens.map((token, i) => {
        const selected = token === value
        return (
          <button
            key={token}
            ref={(el) => {
              buttonRefs.current[i] = el
            }}
            type="button"
            className="ws-colorpicker-swatch"
            style={{ ['--ws-swatch-color' as string]: `var(--ws-${kebab(token)})` }}
            aria-label={`Project colour ${letterOf(token)}${selected ? ' (current)' : ''}`}
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
