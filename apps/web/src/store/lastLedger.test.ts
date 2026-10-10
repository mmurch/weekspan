import { describe, expect, it } from 'vitest'
import { forgetLastLedger, loadLastLedger, saveLastLedger } from './lastLedger.js'

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

const KEY = 'weekspan.lastLedger'

describe('lastLedger — round trip', () => {
  it('remembers nothing by default', () => {
    expect(loadLastLedger(memoryStorage())).toBeNull()
  })

  it('stores and reads back the directory key and file name', () => {
    const store = memoryStorage()
    saveLastLedger({ key: 'dir-1', fileName: 'personal.weekspan.json' }, store)
    expect(loadLastLedger(store)).toEqual({ key: 'dir-1', fileName: 'personal.weekspan.json' })
  })

  it('forgetting clears it', () => {
    const store = memoryStorage()
    saveLastLedger({ key: 'dir-1', fileName: 'a.weekspan.json' }, store)
    forgetLastLedger(store)
    expect(loadLastLedger(store)).toBeNull()
  })
})

describe('lastLedger — a corrupt preference must not brick the first render', () => {
  const bad = [
    'not json at all',
    'null',
    '[]',
    '"a string"',
    '{}',
    '{"key":"only"}',
    '{"fileName":"only.weekspan.json"}',
    '{"key":1,"fileName":2}',
    '{"key":"","fileName":"x"}',
    '{"key":"x","fileName":""}',
  ]

  for (const raw of bad) {
    it(`reads ${raw.slice(0, 28)} as "nothing remembered"`, () => {
      expect(loadLastLedger(memoryStorage({ [KEY]: raw }))).toBeNull()
    })
  }
})

describe('lastLedger — storage failures degrade quietly', () => {
  const hostile = (): Storage => {
    const boom = (): never => {
      throw new Error('nope')
    }
    return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } as unknown as Storage
  }

  it('reads as null when storage throws', () => {
    expect(loadLastLedger(hostile())).toBeNull()
  })

  it('writing and forgetting never propagate', () => {
    expect(() => saveLastLedger({ key: 'a', fileName: 'b' }, hostile())).not.toThrow()
    expect(() => forgetLastLedger(hostile())).not.toThrow()
  })
})
