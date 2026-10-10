import type { IsoDate } from '@weekspan/weekspan-core'
import { parseCapture } from './capture.js'

const today: IsoDate = '2026-08-26' // Wednesday

describe('parseCapture', () => {
  it('resolves the design example: title plus due day-word', () => {
    const c = parseCapture('order tile samples thu', today)

    expect(c.title).toBe('order tile samples')
    expect(c.due).toBe('2026-08-27') // next Thursday on/after 2026-08-26
  })

  it('tokenizes thu as due, spans lining up with the input', () => {
    const input = 'order tile samples thu'
    const c = parseCapture(input, today)

    for (const t of c.tokens) {
      expect(input.slice(t.start, t.end)).toBe(t.value)
    }

    const due = c.tokens.find((t) => t.kind === 'due')!
    expect(due.value).toBe('thu')
    expect(input.slice(due.start, due.end)).toBe('thu')
  })

  it('resolves "wed" to TODAY on a Wednesday (inclusive), not next week', () => {
    const c = parseCapture('stand-up notes wed', today)
    expect(c.due).toBe(today)
  })

  it('resolves "today" and "tomorrow"', () => {
    expect(parseCapture('call the plumber today', today).due).toBe('2026-08-26')
    expect(parseCapture('call the plumber tomorrow', today).due).toBe('2026-08-27')
  })

  it('resolves a relative offset like +3d', () => {
    const c = parseCapture('renew library book +3d', today)
    expect(c.due).toBe('2026-08-29')
  })

  it('resolves a relative week offset like -1w', () => {
    const c = parseCapture('follow up -1w', today)
    expect(c.due).toBe('2026-08-19')
  })

  /*
   * The project is an explicit tick in the overlay, never a guess about the
   * text. These four cases are the ones the old name/prefix matcher got
   * visibly wrong: a word that happens to name a project was silently eaten
   * out of the title and the item filed itself somewhere nobody asked for.
   */
  it('never infers a project, even from a word that exactly names one', () => {
    const c = parseCapture('finish deck Work', today)
    expect(c.projectId).toBeUndefined()
    expect(c.title).toBe('finish deck Work')
  })

  it('keeps a project-prefix word in the title verbatim', () => {
    const c = parseCapture('order samples Weymo', today)
    expect(c.projectId).toBeUndefined()
    expect(c.title).toBe('order samples Weymo')
  })

  it('emits no project tokens at all, so nothing but a day-word highlights', () => {
    const input = 'order tile samples thu weymouth'
    const c = parseCapture(input, today)
    expect(c.tokens.filter((t) => t.kind !== 'text').map((t) => t.value)).toEqual(['thu'])
    expect(c.title).toBe('order tile samples weymouth')
  })

  it('only the LAST due token wins when several appear', () => {
    const c = parseCapture('reschedule mon then actually fri', today)
    // mon -> 2026-08-31 (next Monday), fri -> 2026-08-28 (next Friday); fri appears last.
    expect(c.due).toBe('2026-08-28')
    // Both are still tokenized as due for highlighting purposes.
    const dueTokens = c.tokens.filter((t) => t.kind === 'due')
    expect(dueTokens.map((t) => t.value)).toEqual(['mon', 'fri'])
  })

  it('yields a plain title with no tokens beyond text when nothing resolves', () => {
    const c = parseCapture('buy milk and eggs', today)
    expect(c.title).toBe('buy milk and eggs')
    expect(c.due).toBeUndefined()
    expect(c.projectId).toBeUndefined()
    expect(c.tokens.every((t) => t.kind === 'text')).toBe(true)
  })

  it('handles an empty input', () => {
    const c = parseCapture('', today)
    expect(c.title).toBe('')
    expect(c.tokens).toEqual([])
    expect(c.due).toBeUndefined()
    expect(c.projectId).toBeUndefined()
  })

  it('accepts an explicit ISO date as a due token', () => {
    const c = parseCapture('pay invoice 2026-09-01', today)
    expect(c.due).toBe('2026-09-01')
    expect(c.title).toBe('pay invoice')
  })

  it('still finds due tokens across a newline (quick-capture is now multiline)', () => {
    const input = 'order tile samples\nthu'
    const c = parseCapture(input, today)

    expect(c.due).toBe('2026-08-27')
    // The title is space-joined regardless of the newline in the source.
    expect(c.title).toBe('order tile samples')

    // Token spans still line up with the original (newline-containing) input.
    for (const t of c.tokens) {
      expect(input.slice(t.start, t.end)).toBe(t.value)
    }
  })
})
