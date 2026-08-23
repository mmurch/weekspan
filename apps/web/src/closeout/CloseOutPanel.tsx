import type { Item } from '@weekspan/weekspan-core'
import type { Blocker, CloseOutState } from './closeoutActions.js'
import './CloseOutPanel.css'

/**
 * The close-out panel: what the `×` on a closeable past week opens.
 *
 * Presentational only — everything it draws comes from props, and every
 * action is a callback. It never touches `useWeekspan`'s store or calls
 * `mutate` itself; the caller owns that, exactly like `Grid` owns none of the
 * domain logic it renders.
 *
 * `state` comes from `closeOutState` (see closeoutActions.ts) and can
 * describe either outcome:
 *   - closeable: the panel confirms what will archive and what stays.
 *   - blocked: the panel explains why, with explicit dues and generated
 *     recurring occurrences shown as two visually distinct groups, each
 *     naming its own remedy — conflating them was an actual bug in core
 *     (see closeoutActions.ts), so this must not re-merge them.
 */

export interface CloseOutPanelProps {
  state: CloseOutState
  /**
   * Preview of the items that would archive if `state.week` is closed right
   * now. The panel has no store access, so the caller computes this — a
   * cheap, pure call: `performClose(weekspan, today)?.archived ?? []`.
   * Ignored (and safe to omit) when `state.closeable` is false.
   */
  archivePreview?: Item[]
  /**
   * How many items remain in the weekspan after the close (recurring items
   * are always among them — they never archive). Caller-computed, same as
   * `archivePreview`. Ignored when `state.closeable` is false.
   */
  remainingCount?: number
  /** Confirm the close. The panel never performs the mutation itself. */
  onConfirm: () => void
  /** Dismiss the panel without acting. */
  onDismiss: () => void
}

export function CloseOutPanel(props: CloseOutPanelProps): JSX.Element | null {
  const { state, archivePreview = [], remainingCount = 0, onConfirm, onDismiss } = props

  // Nothing to show — the caller shouldn't have opened the panel for a
  // caught-up weekspan, but staying inert rather than rendering garbage is
  // cheap insurance against a stale click.
  if (state.week === null) return null

  return (
    <div className="ws-closeout-backdrop" onClick={onDismiss}>
      <div
        className="ws-closeout-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Close out ${state.week}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ws-closeout-head">
          <div className="ws-closeout-title">
            <span className="ws-closeout-titletext">Close out</span>
            <span className="ws-closeout-week ws-mono">{state.week}</span>
          </div>
          <button type="button" className="ws-closeout-dismiss" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        </div>

        {state.closeable ? (
          <CloseConfirm
            week={state.week}
            archived={archivePreview}
            remaining={remainingCount}
            onConfirm={onConfirm}
            onDismiss={onDismiss}
          />
        ) : (
          <CloseBlocked state={state} onDismiss={onDismiss} />
        )}
      </div>
    </div>
  )
}

function CloseConfirm({
  week,
  archived,
  remaining,
  onConfirm,
  onDismiss,
}: {
  week: string
  archived: Item[]
  remaining: number
  onConfirm: () => void
  onDismiss: () => void
}): JSX.Element {
  return (
    <div className="ws-closeout-body">
      <p className="ws-closeout-lede">
        {archived.length === 0
          ? `Nothing to archive — ${week} is already clear.`
          : `${archived.length} item${archived.length === 1 ? '' : 's'} will archive out of the working file.`}
      </p>

      {archived.length > 0 ? (
        <ul className="ws-closeout-list ws-closeout-list--archive">
          {archived.map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
        </ul>
      ) : null}

      {/* Said explicitly: recurring items are never archived, and a user who
          doesn't know that will think they were lost. */}
      <p className="ws-closeout-note">
        {remaining} item{remaining === 1 ? '' : 's'} will stay in the weekspan. Recurring items are
        never archived — they carry on unchanged.
      </p>

      <div className="ws-closeout-actions">
        <button type="button" className="ws-closeout-btn ws-closeout-btn--ghost" onClick={onDismiss}>
          Cancel
        </button>
        <button type="button" className="ws-closeout-btn ws-closeout-btn--primary" onClick={onConfirm}>
          Close {week}
        </button>
      </div>
    </div>
  )
}

function BlockerRow({ blocker }: { blocker: Blocker }): JSX.Element {
  return (
    <li className="ws-closeout-blocker">
      <span className="ws-closeout-blocker-date ws-mono">{blocker.date}</span>
      <span className="ws-closeout-blocker-title">{blocker.title}</span>
    </li>
  )
}

function CloseBlocked({ state, onDismiss }: { state: CloseOutState; onDismiss: () => void }): JSX.Element {
  return (
    <div className="ws-closeout-body">
      <p className="ws-closeout-lede">{state.week} can&rsquo;t close yet.</p>

      {/* Two visually distinct groups — an explicit due and a generated
          recurring occurrence need different remedies, and showing them
          identically leaves the user unable to tell what to do. */}
      {state.explicitBlockers.length > 0 ? (
        <div className="ws-closeout-group ws-closeout-group--explicit">
          <div className="ws-closeout-group-head">
            <span className="ws-closeout-group-chip ws-closeout-group-chip--due">DUE</span>
            <span className="ws-closeout-group-remedy">Complete or clear these to continue.</span>
          </div>
          <ul className="ws-closeout-list">
            {state.explicitBlockers.map((b) => (
              <BlockerRow blocker={b} key={`${b.itemId}-${b.date}`} />
            ))}
          </ul>
        </div>
      ) : null}

      {state.generatedBlockers.length > 0 ? (
        <div className="ws-closeout-group ws-closeout-group--generated">
          <div className="ws-closeout-group-head">
            <span className="ws-closeout-group-chip ws-closeout-group-chip--generated">RECURS</span>
            <span className="ws-closeout-group-remedy">
              Skip these in the grid, or leave them — they auto-skip the next time you open Weekspan.
            </span>
          </div>
          <ul className="ws-closeout-list">
            {state.generatedBlockers.map((b) => (
              <BlockerRow blocker={b} key={`${b.itemId}-${b.date}`} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ws-closeout-actions">
        <button type="button" className="ws-closeout-btn ws-closeout-btn--ghost" onClick={onDismiss}>
          Close
        </button>
      </div>
    </div>
  )
}
