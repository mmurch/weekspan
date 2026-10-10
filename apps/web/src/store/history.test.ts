import { describe, expect, it } from 'vitest'
import { emptyHistory, record, redo, undo, type History } from './history.js'

const MAX = 50

/** Strings stand in for weekspans — the module is deliberately ignorant of both. */
type H = History<string>

/** Walk a sequence of changes, returning the history and the current value. */
function apply(changes: string[], max = MAX): { history: H; current: string } {
  let history: H = emptyHistory<string>()
  let current = 'v0'
  for (const next of changes) {
    history = record(history, current, max)
    current = next
  }
  return { history, current }
}

describe('record', () => {
  it('makes the previous state undoable', () => {
    const { history } = apply(['v1'])
    expect(history.past).toEqual(['v0'])
    expect(history.future).toEqual([])
  })

  it('stacks changes oldest-first', () => {
    const { history } = apply(['v1', 'v2', 'v3'])
    expect(history.past).toEqual(['v0', 'v1', 'v2'])
  })

  it('bounds the stack from the OLD end, so recent steps always survive', () => {
    const { history } = apply(['v1', 'v2', 'v3', 'v4'], 2)
    expect(history.past).toEqual(['v2', 'v3'])
  })

  it('a max of zero disables history entirely rather than misbehaving', () => {
    const { history } = apply(['v1', 'v2'], 0)
    expect(history).toEqual(emptyHistory())
  })

  it('never mutates the history it was given', () => {
    const before = emptyHistory<string>()
    record(before, 'v0', MAX)
    expect(before).toEqual({ past: [], future: [] })
  })
})

describe('undo', () => {
  it('returns null when there is nothing to undo — the caller writes nothing', () => {
    expect(undo(emptyHistory<string>(), 'v0', MAX)).toBeNull()
  })

  it('steps back one state and offers the current one for redo', () => {
    const { history, current } = apply(['v1'])
    const result = undo(history, current, MAX)!
    expect(result.target).toBe('v0')
    expect(result.history.past).toEqual([])
    expect(result.history.future).toEqual(['v1'])
  })

  it('walks several steps back in order', () => {
    let { history, current } = apply(['v1', 'v2', 'v3'])
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = undo(history, current, MAX)!
      seen.push(r.target)
      history = r.history
      current = r.target
    }
    expect(seen).toEqual(['v2', 'v1', 'v0'])
    expect(undo(history, current, MAX)).toBeNull() // bottomed out
  })
})

describe('redo', () => {
  it('returns null when nothing has been undone', () => {
    const { history, current } = apply(['v1'])
    expect(redo(history, current, MAX)).toBeNull()
  })

  it('retraces exactly the states undo walked back through', () => {
    let { history, current } = apply(['v1', 'v2', 'v3'])
    for (let i = 0; i < 3; i++) {
      const r = undo(history, current, MAX)!
      history = r.history
      current = r.target
    }
    const forward: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = redo(history, current, MAX)!
      forward.push(r.target)
      history = r.history
      current = r.target
    }
    expect(forward).toEqual(['v1', 'v2', 'v3'])
    expect(redo(history, current, MAX)).toBeNull()
  })

  it('undo-then-redo returns the history to where it started', () => {
    const { history, current } = apply(['v1', 'v2'])
    const back = undo(history, current, MAX)!
    const forward = redo(back.history, back.target, MAX)!
    expect(forward.target).toBe(current)
    expect(forward.history).toEqual(history)
  })
})

describe('a new change branches off — redo is dropped', () => {
  it('recording after an undo clears the forward states', () => {
    // Otherwise a redo could jump to a future that no longer follows from the
    // present, which is the classic way undo stacks corrupt state.
    const { history, current } = apply(['v1', 'v2'])
    const back = undo(history, current, MAX)!
    expect(back.history.future).toEqual(['v2'])

    const branched = record(back.history, back.target, MAX)
    expect(branched.future).toEqual([])
    expect(redo(branched, 'v9', MAX)).toBeNull()
  })

  it('the branched past still leads back through the states actually visited', () => {
    const { history, current } = apply(['v1', 'v2'])
    const back = undo(history, current, MAX)! // now at v1
    const branched = record(back.history, back.target, MAX) // change v1 -> v9
    const again = undo(branched, 'v9', MAX)!
    expect(again.target).toBe('v1')
  })
})

describe('invalidation is the caller\'s job, and total', () => {
  it('emptyHistory drops both directions', () => {
    const { history, current } = apply(['v1', 'v2'])
    const back = undo(history, current, MAX)!
    expect(back.history.past.length + back.history.future.length).toBeGreaterThan(0)

    const cleared = emptyHistory<string>()
    expect(undo(cleared, current, MAX)).toBeNull()
    expect(redo(cleared, current, MAX)).toBeNull()
  })
})

describe('depth reporting matches what actually steps', () => {
  it('past.length is exactly how many undos will succeed', () => {
    let { history, current } = apply(['v1', 'v2', 'v3', 'v4'])
    let steps = 0
    for (;;) {
      const r = undo(history, current, MAX)
      if (r === null) break
      history = r.history
      current = r.target
      steps++
    }
    expect(steps).toBe(4)
  })

  it('holds at the cap too, so a dimmed hint never lies', () => {
    let { history, current } = apply(['v1', 'v2', 'v3', 'v4', 'v5'], 3)
    expect(history.past).toHaveLength(3)
    let steps = 0
    for (;;) {
      const r = undo(history, current, 3)
      if (r === null) break
      history = r.history
      current = r.target
      steps++
    }
    expect(steps).toBe(3)
  })
})
