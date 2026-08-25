import { PROJECT_COLOR_TOKENS } from '@weekspan/weekspan-core'
import { describe, expect, it } from 'vitest'
import { loadNoProjectColor, saveNoProjectColor } from './noProjectColor.js'

/** A minimal in-memory Storage, so these never touch the real localStorage. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

/** Storage that throws on every access — private mode, disabled cookies, quota. */
function hostileStorage(): Storage {
  const boom = (): never => {
    throw new Error('storage unavailable')
  }
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } as unknown as Storage
}

const FIRST = PROJECT_COLOR_TOKENS[0]!

describe('noProjectColor — round trip', () => {
  it('defaults to null (colourless), the historical behaviour', () => {
    expect(loadNoProjectColor(memoryStorage())).toBeNull()
  })

  it('persists and reads back a chosen token', () => {
    const store = memoryStorage()
    saveNoProjectColor(FIRST, store)
    expect(loadNoProjectColor(store)).toBe(FIRST)
  })

  it('null clears it rather than storing the string "null"', () => {
    const store = memoryStorage()
    saveNoProjectColor(FIRST, store)
    saveNoProjectColor(null, store)
    expect(loadNoProjectColor(store)).toBeNull()
    // Nothing left behind that a later reader could misinterpret.
    expect(store.getItem('weekspan.noProjectColor')).toBeNull()
  })

  it('every token in the live ramp survives a round trip', () => {
    for (const token of PROJECT_COLOR_TOKENS) {
      const store = memoryStorage()
      saveNoProjectColor(token, store)
      expect(loadNoProjectColor(store)).toBe(token)
    }
  })
})

describe('noProjectColor — untrusted input', () => {
  it('rejects a token that is not in the ramp', () => {
    // A value from a future build, or a hand-edited one, would resolve to a CSS
    // custom property that does not exist and paint the bar transparent with no
    // clue why. Falling back to colourless is at least an honest state.
    expect(loadNoProjectColor(memoryStorage({ 'weekspan.noProjectColor': 'barZZ' }))).toBeNull()
    expect(loadNoProjectColor(memoryStorage({ 'weekspan.noProjectColor': '' }))).toBeNull()
    expect(loadNoProjectColor(memoryStorage({ 'weekspan.noProjectColor': 'null' }))).toBeNull()
  })

  it('does not admit a CSS injection attempt', () => {
    const nasty = 'barA); background: url(evil'
    expect(loadNoProjectColor(memoryStorage({ 'weekspan.noProjectColor': nasty }))).toBeNull()
  })
})

describe('noProjectColor — storage failures degrade quietly', () => {
  it('reads as colourless when storage throws', () => {
    expect(loadNoProjectColor(hostileStorage())).toBeNull()
  })

  it('writing when storage throws does not propagate', () => {
    expect(() => saveNoProjectColor(FIRST, hostileStorage())).not.toThrow()
    expect(() => saveNoProjectColor(null, hostileStorage())).not.toThrow()
  })
})
