import { isTypingTarget } from '../interaction/isTypingTarget.js'

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
