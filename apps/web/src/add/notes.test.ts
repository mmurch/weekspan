import { demoWeekspan } from '../grid/fixtures.js'
import { commitNotes, linesToNotes, notesToLines } from './notes.js'

const TODAY = '2026-08-26'

describe('notesToLines / linesToNotes', () => {
  it('splits stored bullet lines, stripping the dash and surrounding space', () => {
    expect(notesToLines('- one\n- two\n- three')).toEqual(['one', 'two', 'three'])
  })

  it('accepts freehand lines with no leading dash', () => {
    expect(notesToLines('one\ntwo')).toEqual(['one', 'two'])
  })

  it('accepts a leading * bullet too', () => {
    expect(notesToLines('* one\n* two')).toEqual(['one', 'two'])
  })

  it('drops blank lines', () => {
    expect(notesToLines('- one\n\n- two\n   \n- three')).toEqual(['one', 'two', 'three'])
  })

  it('trims stray whitespace around each line', () => {
    expect(notesToLines('  - one  \n-   two')).toEqual(['one', 'two'])
  })

  it('returns an empty array for undefined or blank input', () => {
    expect(notesToLines(undefined)).toEqual([])
    expect(notesToLines('')).toEqual([])
    expect(notesToLines('   \n  ')).toEqual([])
  })

  it('linesToNotes prefixes every line with "- " and joins with newlines', () => {
    expect(linesToNotes(['one', 'two'])).toBe('- one\n- two')
  })

  it('round-trips multi-line notes', () => {
    const stored = '- first\n- second\n- third'
    expect(linesToNotes(notesToLines(stored))).toBe(stored)
  })
})

describe('commitNotes', () => {
  it('writes normalised bullets for a brand-new note', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-paint' // no notes in the fixture
    const next = commitNotes(base, id, 'buy paint\nbring swatches')
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === id)!.notes).toBe('- buy paint\n- bring swatches')
  })

  it('updates existing notes', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-tiles' // has notes in the fixture
    const next = commitNotes(base, id, 'new note only')
    expect(next).not.toBeNull()
    expect(next!.items.find((i) => i.id === id)!.notes).toBe('- new note only')
  })

  it('clearing all notes removes the field entirely rather than storing an empty string', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-tiles'
    const next = commitNotes(base, id, '   \n  ')
    expect(next).not.toBeNull()
    const item = next!.items.find((i) => i.id === id)!
    expect(item.notes).toBeUndefined()
    expect('notes' in item).toBe(false)
  })

  it('retyping the same content with different dashes is a no-op', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-tiles'
    // fixture stores '- oak-look, budget under $3/tile\n- check return policy\n- order samples first'
    const retyped =
      'oak-look, budget under $3/tile\ncheck return policy\norder samples first'
    expect(commitNotes(base, id, retyped)).toBeNull()
  })

  it('unchanged content (identical dashes) is also a no-op', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-tiles'
    const current = base.items.find((i) => i.id === id)!.notes!
    expect(commitNotes(base, id, current)).toBeNull()
  })

  it('setting notes to the same content on an item that had none is a no-op', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-paint'
    expect(commitNotes(base, id, '   ')).toBeNull()
  })

  it('multi-line round-trip: what is written back out matches what was typed, normalised', () => {
    const base = demoWeekspan(TODAY)
    const id = 'item-paint'
    const typed = '- already dashed\nplain line\n*  starred line'
    const next = commitNotes(base, id, typed)!
    expect(next.items.find((i) => i.id === id)!.notes).toBe(
      '- already dashed\n- plain line\n- starred line',
    )
  })

  it('returns null for an id that does not resolve, rather than throwing', () => {
    const base = demoWeekspan(TODAY)
    expect(() => commitNotes(base, 'no-such-id', 'x')).not.toThrow()
    expect(commitNotes(base, 'no-such-id', 'x')).toBeNull()
  })

  it('does not mutate other items', () => {
    const base = demoWeekspan(TODAY)
    const next = commitNotes(base, 'item-paint', 'a note')!
    for (const before of base.items) {
      if (before.id === 'item-paint') continue
      expect(next.items.find((i) => i.id === before.id)).toEqual(before)
    }
  })
})
