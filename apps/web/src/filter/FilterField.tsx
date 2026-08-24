import type { ChangeEvent, KeyboardEvent } from 'react'
import './FilterField.css'

export interface FilterFieldProps {
  value: string
  onChange: (value: string) => void
  /**
   * How many rows currently match, and how many there were before filtering.
   * Both are optional — omit them (e.g. before a weekspan has loaded, or the
   * caller doesn't want the count) and the field renders as a plain input
   * with no count/empty-state row. Pass both once there's something to
   * report; a filtered-to-zero result renders a plain "no matches" message
   * rather than nothing, so an aggressive filter never reads as "all my data
   * is gone."
   */
  matchCount?: number
  totalCount?: number
}

/**
 * The `/ filter` box in the top bar — a controlled input replacing the
 * formerly-inert `.ws-filter` span (see `src/styles/app.css`).
 *
 * Presentational only: it owns no filter logic (that's `filter.ts`) and no
 * keyboard-focus wiring beyond its own field (a global "press `/` to focus"
 * shortcut, if wanted, belongs in the top-level keydown handler that already
 * exists for other shortcuts, not here).
 */
export function FilterField({ value, onChange, matchCount, totalCount }: FilterFieldProps): JSX.Element {
  const active = value.trim() !== ''
  const showCount = active && matchCount !== undefined && totalCount !== undefined
  const noMatches = showCount && matchCount === 0

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    onChange(e.target.value)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape' && value !== '') {
      e.preventDefault()
      e.stopPropagation()
      onChange('')
    }
  }

  return (
    <div className={`ws-filter-field${active ? ' ws-filter-field--active' : ''}`}>
      <input
        className="ws-filter-field-input"
        type="text"
        value={value}
        placeholder="/ filter"
        aria-label="Filter items"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {showCount ? (
        <span
          className={`ws-filter-field-count${noMatches ? ' ws-filter-field-count--empty' : ''}`}
          role="status"
        >
          {noMatches ? 'no matches' : `${matchCount} / ${totalCount}`}
        </span>
      ) : null}
    </div>
  )
}
