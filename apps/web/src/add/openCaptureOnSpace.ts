/**
 * Whether a bare spacebar press (no modifiers) should open quick-capture.
 *
 * Spacebar is also the page-scroll key and, on a focused `<button>` or
 * `<select>`, a native activation key — opening an overlay on top of any of
 * that is a bad surprise, so this is deliberately conservative: any modifier
 * held, or focus anywhere text-entry-ish or natively space-driven, refuses.
 *
 * `isTypingTarget` below is a byte-for-byte copy of the unexported function
 * of the same name in `src/interaction/keymap.ts` (which `resolveKey` uses
 * to refuse shortcuts while typing). That file is off-limits to edit for
 * this change, so the logic is duplicated rather than imported — but it must
 * stay IDENTICAL, not a looser approximation, since this guard is at least
 * as safety-critical as the one it mirrors. Keep the two in sync if that
 * logic ever changes.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const t = target as { tagName?: unknown; isContentEditable?: unknown }
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true
  if (t.isContentEditable === true) return true
  return false
}

/**
 * Controls where Space already has a native, expected meaning of its own
 * (activating a button, opening a select) — not covered by `isTypingTarget`
 * since typing a letter into a button/select isn't otherwise meaningful, but
 * Space specifically is.
 */
function isSpaceMeaningfulControl(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const t = target as { tagName?: unknown }
  return t.tagName === 'BUTTON' || t.tagName === 'SELECT'
}

export function shouldOpenCaptureOnSpace(e: KeyboardEvent): boolean {
  if (e.key !== ' ' && e.key !== 'Spacebar') return false
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
  if (isTypingTarget(e.target)) return false
  if (isSpaceMeaningfulControl(e.target)) return false
  return true
}
