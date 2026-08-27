/**
 * Mouse interaction for the Weekspan grid.
 *
 * `intentForMouse` is the mouse equivalent of `keymap.ts`'s `resolveKey`: a
 * pure `(raw input fields) -> intent` mapping with no DOM dependency, so it
 * is unit-testable under plain Node (no jsdom in this workspace) and the
 * mapping table lives in exactly one place.
 *
 * The mapping:
 *
 *   left click    (button 0) -> select the cell, nothing else
 *   left double   (button 0, detail >= 2) -> menu
 *   middle click  (button 1) -> nothing
 *   right click   (button 2) -> cycle the cell's mark
 *
 * This replaced an absolute mapping (left = due, right = done, middle =
 * clear, double = menu). Two consequences worth stating, because both were
 * forced by the change rather than chosen freely:
 *
 * **Right click is NOT gated on `detail`.** Cycling means clicking the same
 * cell repeatedly — due, then done, then blank — and the old `detail >= 2`
 * rule would have swallowed the second click of every such run and opened the
 * menu instead. So the double-click check now applies to the LEFT button only,
 * where it cannot collide: left is select, and select-then-open-menu is a
 * coherent thing for a double click to mean.
 *
 * **The menu stays reachable, on left double-click.** The brief named all
 * three buttons and did not mention the menu; dropping it silently would have
 * removed a surface the user never asked to lose, and right click — its
 * conventional home, and where the design handoff put it — is now the cycle.
 *
 * `MouseIntent` deliberately shares its tags with `keymap.ts`'s
 * `Action['kind']`. That is not a coincidence: the caller (`App.tsx`) routes
 * every non-`select`, non-`menu` intent through `applyAction` by passing
 * `{ kind: intent.kind }` straight through, so mouse and keyboard can never
 * disagree about what "cycle" means — same vacation-day refusal, same
 * selection handling, one code path. `cycle` is exactly what Enter already
 * does. `menu` and `select` have no `Action` counterpart on purpose: both are
 * UI concerns (popup position, selection state), not weekspan mutations.
 */

export type MouseIntent =
  /** Move the selection here and do nothing else. */
  | { kind: 'select' }
  /** Advance the cell one step through its own loop — same as Enter. */
  | { kind: 'cycle' }
  | { kind: 'menu' }

/**
 * Maps a mouse event's `button` and `detail` fields to a `MouseIntent`, or
 * `null` for anything unmapped — the middle button, and the fourth/fifth
 * "back"/"forward" buttons. Returning `null` rather than guessing matches
 * `resolveKey`'s contract in `keymap.ts`.
 *
 * `button` follows the standard `MouseEvent.button` values: 0 = left,
 * 1 = middle, 2 = right. `detail` is the DOM's click-count field (1 for a
 * single click, 2 for the second click of a double click, and so on) and is
 * consulted for the LEFT button only — see the module doc for why right click
 * must fire on every click regardless.
 */
export function intentForMouse(button: number, detail: number): MouseIntent | null {
  switch (button) {
    case 0:
      return detail >= 2 ? { kind: 'menu' } : { kind: 'select' }
    case 1:
      // Middle click does nothing. It used to clear the cell, which is a
      // destructive write on a button people press by accident while scrolling.
      return null
    case 2:
      return { kind: 'cycle' }
    default:
      return null
  }
}
