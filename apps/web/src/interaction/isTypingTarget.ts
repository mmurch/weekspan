/**
 * Is the event coming from somewhere the user is typing?
 *
 * Every global keyboard shortcut needs this guard: `d` must type a "d" in a
 * title, not set a due date, and Cmd+Z inside a text field must be the
 * browser's own undo, not the grid's.
 *
 * Structural checks rather than `instanceof HTMLElement`, so the callers stay
 * unit-testable under plain Node — there is no jsdom in this workspace, and
 * `HTMLElement` does not exist as a global there at all.
 *
 * This lived as two byte-identical private copies (in `keymap.ts` and
 * `openCaptureOnSpace.ts`) with a comment on one saying the other was
 * off-limits to edit at the time and that the two must be kept in sync by
 * hand. They are one function now.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const t = target as { tagName?: unknown; isContentEditable?: unknown }
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true
  if (t.isContentEditable === true) return true
  return false
}
