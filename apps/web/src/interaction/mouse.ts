/**
 * Mouse interaction for the Weekspan grid.
 *
 * `intentForMouse` is the mouse equivalent of `keymap.ts`'s `resolveKey`: a
 * pure `(raw input fields) -> intent` mapping with no DOM dependency, so it
 * is unit-testable under plain Node (no jsdom in this workspace) and the
 * mapping table lives in exactly one place.
 *
 * The mapping (absolute, not a toggle — a left click on a cell that is
 * already DUE leaves it DUE):
 *
 *   left click    (button 0) -> setDue
 *   right click   (button 2) -> setDone
 *   middle click  (button 1) -> clear
 *   double click  (any button, detail 2) -> menu
 *
 * `MouseIntent` deliberately shares its non-`menu` tags ('setDue' | 'setDone'
 * | 'clear') with `keymap.ts`'s `Action['kind']`. That is not a coincidence:
 * the caller (`App.tsx`) is expected to route every non-`menu` intent through
 * `applyAction` by passing `{ kind: intent.kind }` straight through, so mouse
 * and keyboard can never disagree about what "set due" means — same
 * vacation-day refusal, same selection handling, one code path. `menu` has
 * no `Action` counterpart on purpose: opening the cell popup is a UI concern
 * (position, open/closed state), not a weekspan mutation, so it is handled
 * by the caller directly instead of round-tripping through the reducer.
 *
 * ## Why `detail`, not a debounce timer
 *
 * A double click fires, in order: `click` (detail 1), `click` (detail 2),
 * `dblclick`. A naive wiring that reacts to every `click` sets DUE twice and
 * THEN opens the menu — wrong, and worse, order-dependent on however the
 * menu handler is wired.
 *
 * Two fixes were on the table: (a) debounce the single-click handler by the
 * platform's double-click threshold, so a lone click only "commits" after
 * the window closes with no second click, or (b) use `event.detail` — which
 * the DOM already increments to 2 on the second `click` of a double-click —
 * to recognize the second click as the double-click signal, and let the
 * (idempotent) first click through immediately.
 *
 * This module takes (b). Reasons:
 *
 *   - No timer, no setTimeout to clear on unmount, no perceived input lag on
 *     an ordinary single click (a debounce would delay every DUE/DONE/clear
 *     by ~300-500ms, which is the majority of clicks a user makes).
 *   - `setDue` (and `setDone`, and `clear`) are absolute writes, not toggles
 *     — see `keymap.ts`'s `applyMark` — so the first click of a double-click
 *     firing `setDue` before the second click fires `menu` is harmless: the
 *     cell ends up DUE (once; `applyAction`'s no-op-on-same-reference
 *     contract means the second `setDue`-shaped call some OTHER caller might
 *     make is a no-write no-op too) and the menu opens on top of it. No
 *     wrong final state, no double write, no flicker.
 *   - It only requires the CALLER (`Grid.tsx`) to wire ONE event
 *     (`onClick`, reading `e.detail`) for the left-button path instead of
 *     coordinating a timer against a separate `onDoubleClick`. See the
 *     wiring notes recorded against this change for exactly which DOM
 *     events each button needs and why (short version: `dblclick` itself is
 *     never wired — the second `click`, detail 2, already covers it).
 *
 * `detail >= 2` is checked before the per-button switch and wins regardless
 * of which button produced it, because a double click (or a triple click,
 * which the DOM reports as detail 3, etc.) always means "open the menu" no
 * matter which button started the sequence.
 */

export type MouseIntent =
  | { kind: 'setDue' }
  | { kind: 'setDone' }
  | { kind: 'clear' }
  | { kind: 'menu' }

/**
 * Maps a mouse event's `button` and `detail` fields to a `MouseIntent`, or
 * `null` for anything unmapped (e.g. a fourth/fifth "back"/"forward" mouse
 * button) — returning `null` rather than guessing matches `resolveKey`'s
 * contract in `keymap.ts`.
 *
 * `button` follows the standard `MouseEvent.button` values: 0 = left,
 * 1 = middle, 2 = right. `detail` is the DOM's built-in click-count field
 * (1 for a single click, 2 for the second click of a double click, and so
 * on) — see the module doc for why checking it here, rather than debouncing
 * in the caller, is how double click is disambiguated from two single
 * clicks.
 */
export function intentForMouse(button: number, detail: number): MouseIntent | null {
  if (detail >= 2) return { kind: 'menu' }

  switch (button) {
    case 0:
      return { kind: 'setDue' }
    case 1:
      return { kind: 'clear' }
    case 2:
      return { kind: 'setDone' }
    default:
      return null
  }
}
