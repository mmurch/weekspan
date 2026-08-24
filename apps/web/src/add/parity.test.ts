import { parseCapture } from './capture.js'

/**
 * Quick capture and the CLI must resolve the same word to the same date.
 *
 * They share `tryParseDateWord` from weekspan-core, so this holds structurally
 * today. The test exists to catch someone reintroducing a local copy — which is
 * exactly what happened before, and the failure mode is silent: an agent adding
 * `thu` via the CLI and a person typing `thu` here would land on different days
 * with nothing to flag it.
 *
 * The expected values below were produced by running the BUILT CLI binary, not
 * by reading the implementation.
 */
const TODAY = '2026-08-26' // Wednesday

describe('quick capture resolves dates identically to the CLI', () => {
  const due = (word: string): string | undefined => parseCapture(`task ${word}`, [], TODAY).due

  it.each([
    ['thu', '2026-08-27'],
    ['today', '2026-08-26'],
    ['+3d', '2026-08-29'],
    ['-1w', '2026-08-19'],
    ['2026-08-27', '2026-08-27'],
  ])('%s resolves to %s', (word, expected) => {
    expect(due(word)).toBe(expected)
  })

  it('treats a Wednesday word as today, not next week', () => {
    // The inclusive rule: typing `wed` ON a Wednesday means today.
    expect(due('wed')).toBe(TODAY)
  })

  it('leaves an unparseable word in the title rather than guessing a date', () => {
    const c = parseCapture('task +3m', [], TODAY)
    expect(c.due).toBeUndefined()
    expect(c.title).toContain('+3m')
  })
})
