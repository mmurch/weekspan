import { shouldOpenCaptureOnSpace } from './openCaptureOnSpace.js'

/**
 * A minimal stand-in for `KeyboardEvent`, matching the pattern used in
 * `src/interaction/keymap.test.ts` — this workspace's vitest config has no
 * DOM environment (no jsdom), so there is no global `KeyboardEvent`
 * constructor, and `shouldOpenCaptureOnSpace` only reads a handful of fields
 * off the event, so a plain object satisfies it.
 */
function fakeSpaceEvent(
  opts: { alt?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean; target?: unknown; key?: string } = {},
): KeyboardEvent {
  return {
    key: opts.key ?? ' ',
    altKey: opts.alt ?? false,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    target: opts.target ?? null,
  } as unknown as KeyboardEvent
}

describe('shouldOpenCaptureOnSpace', () => {
  it('returns true for a bare spacebar press with no special target', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent())).toBe(true)
  })

  it('returns true when the target is an unremarkable element (e.g. a div)', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: { tagName: 'DIV' } }))).toBe(true)
  })

  it('returns false when the key is not a space', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ key: 'a' }))).toBe(false)
  })

  it('returns false when the target is an <input>', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: { tagName: 'INPUT' } }))).toBe(false)
  })

  it('returns false when the target is a <textarea>', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: { tagName: 'TEXTAREA' } }))).toBe(false)
  })

  it('returns false when the target is contenteditable', () => {
    expect(
      shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: { tagName: 'DIV', isContentEditable: true } })),
    ).toBe(false)
  })

  it('returns false when the target is a <button>', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: { tagName: 'BUTTON' } }))).toBe(false)
  })

  it('returns false when the target is a <select>', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: { tagName: 'SELECT' } }))).toBe(false)
  })

  it('returns false when Cmd (metaKey) is held', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ meta: true }))).toBe(false)
  })

  it('returns false when Ctrl is held', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ ctrl: true }))).toBe(false)
  })

  it('returns false when Alt/Option is held', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ alt: true }))).toBe(false)
  })

  it('returns false when Shift is held', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ shift: true }))).toBe(false)
  })

  it('returns true when the target is null and no modifiers are held', () => {
    expect(shouldOpenCaptureOnSpace(fakeSpaceEvent({ target: null }))).toBe(true)
  })
})
