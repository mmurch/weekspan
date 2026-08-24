import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { THEMES, type ThemeChoice } from '../theme.js'
import './ThemePicker.css'

/**
 * Theme picker (design handoff "8. Theme picker", `#5d`).
 *
 * A compact pill — round swatch, theme name, `▾` — at the right end of the
 * top bar. Click (or Enter/Space) opens a menu of the four choices; the
 * active one carries a `✓`. Purely presentational — no store access, no
 * `localStorage` — the caller supplies `value` and gets the new choice back
 * via `onChange`. Persistence and applying the choice to the DOM are
 * `theme.ts`'s job (`saveTheme` / `applyTheme`), not this component's:
 * theme choice is per-device and must never reach the weekspan file.
 *
 * Unlike `ProjectColorPicker` (a popover the parent mounts/unmounts), this
 * component owns its own open/closed state, because the trigger pill itself
 * is part of what's being built here — there is nowhere else in the top bar
 * for it to live. `onClose` is therefore optional: it's a notification for
 * the caller (e.g. tests), not something the caller needs in order to hide
 * the menu.
 *
 * Swatches paint from `THEMES[].swatch` (see `theme.ts`) rather than a live
 * `--ws-*` custom property, and deliberately so: a custom property reflects
 * only the ONE currently-applied theme, but this menu must show all four
 * options' own colours at once — including the three that are not active —
 * which a live token cannot do. `THEMES` already carries those preview
 * values (including the split light/dark gradient for "system"); this
 * component does not invent any new colour literal, only consumes that
 * existing source of truth. The picker's own chrome (background, border,
 * hover, focus ring, check mark) uses `--ws-*` tokens throughout, so it
 * repaints correctly across Paper, Solarized dark and Warm dark.
 */

export interface ThemePickerProps {
  /** The currently active theme choice. */
  value: ThemeChoice
  /** Called with the newly chosen theme when the user picks a row (click or Enter). */
  onChange: (choice: ThemeChoice) => void
  /** Called whenever the menu closes — Escape, outside click, or a pick. Optional: the menu's open state is internal, so nothing depends on this being wired up. */
  onClose?: () => void
}

export interface ThemeDescriptor {
  label: string
  swatch: string
}

/**
 * Looks up a theme's label/swatch by id. Falls back to `THEMES[0]` (Paper)
 * for an id `THEMES` doesn't recognize, so this stays pure and total rather
 * than throwing or returning `undefined` — the trigger pill always has
 * something to render even if `value` is ever unexpected.
 */
export function describeTheme(id: ThemeChoice): ThemeDescriptor {
  const found = THEMES.find((t) => t.id === id) ?? THEMES[0]!
  return { label: found.label, swatch: found.swatch }
}

/**
 * Pure roving-focus step for the menu's arrow-key handling — same
 * conventions as `ProjectColorPicker`: Right/Down advance, Left/Up retreat,
 * both wrap at the ends. Any other key leaves the index unchanged. Extracted
 * so the wraparound logic is testable without mounting a component (this
 * project's test env has no jsdom).
 */
export function moveIndex(current: number, key: string, length: number): number {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % length
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + length) % length
    default:
      return current
  }
}

function indexOfTheme(id: ThemeChoice): number {
  const i = THEMES.findIndex((t) => t.id === id)
  return i === -1 ? 0 : i
}

export function ThemePicker({ value, onChange, onClose }: ThemePickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(() => indexOfTheme(value))
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  function close(): void {
    setOpen(false)
    onClose?.()
  }

  function openMenu(): void {
    // Roving focus starts on the currently-active theme, same convention as
    // ProjectColorPicker starting from "where you are."
    setFocusIndex(indexOfTheme(value))
    setOpen(true)
  }

  // Move actual DOM focus to match focusIndex whenever the menu opens or the
  // roving index changes via keyboard.
  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus()
  }, [open, focusIndex])

  // Closes on any pointer-down outside the picker (trigger + menu together),
  // same convention as ProjectColorPicker / CellMenu. Capture phase so it
  // beats a click handler underneath.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
      close()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open, onClose])

  function pick(id: ThemeChoice): void {
    onChange(id)
    close()
    triggerRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        setFocusIndex((i) => moveIndex(i, e.key, THEMES.length))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(THEMES[focusIndex]!.id)
        break
      case 'Escape':
        e.preventDefault()
        close()
        triggerRef.current?.focus()
        break
    }
  }

  const current = describeTheme(value)

  return (
    <div className="ws-themepicker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ws-themepicker-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
      >
        <span
          className="ws-themepicker-trigger-swatch"
          style={{ background: current.swatch }}
          aria-hidden="true"
        />
        <span className="ws-themepicker-trigger-label">{current.label}</span>
        <span className="ws-themepicker-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="ws-themepicker-menu"
          role="menu"
          aria-label="Theme"
          onKeyDown={handleKeyDown}
        >
          {THEMES.map((theme, i) => {
            const selected = theme.id === value
            return (
              <button
                key={theme.id}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="ws-themepicker-item"
                tabIndex={i === focusIndex ? 0 : -1}
                onClick={() => pick(theme.id)}
                onFocus={() => setFocusIndex(i)}
              >
                <span
                  className="ws-themepicker-item-swatch"
                  style={{ background: theme.swatch }}
                  aria-hidden="true"
                />
                <span className="ws-themepicker-item-label">{theme.label}</span>
                {selected ? (
                  <span className="ws-themepicker-item-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
