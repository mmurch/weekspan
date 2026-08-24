import type { Weekspan } from '@weekspan/weekspan-core'
import { createWeekspan } from '@weekspan/weekspan-core'
import { commitProjectCapture } from './projectCapture.js'

function weekspanWithProjects(names: string[]): Weekspan {
  const base = createWeekspan({ items: [] })
  return {
    ...base,
    projects: names.map((name, i) => ({ id: `proj-${i}`, name, colorToken: 'barA' })),
  }
}

describe('commitProjectCapture', () => {
  it('creates a project with a plain name, assigning a colour from the ramp', () => {
    const w = weekspanWithProjects([])
    const result = commitProjectCapture(w, 'Weymouth')

    expect(result).not.toBeNull()
    const project = result!.projects.find((p) => p.name === 'Weymouth')
    expect(project).toBeDefined()
    expect(project!.colorToken).toBeTruthy()
  })

  it('returns null for a blank name', () => {
    const w = weekspanWithProjects([])
    expect(commitProjectCapture(w, '')).toBeNull()
  })

  it('returns null for a whitespace-only name', () => {
    const w = weekspanWithProjects([])
    expect(commitProjectCapture(w, '   \n\t  ')).toBeNull()
  })

  it('trims surrounding whitespace from an otherwise valid name', () => {
    const w = weekspanWithProjects([])
    const result = commitProjectCapture(w, '  Weymouth  ')

    expect(result).not.toBeNull()
    expect(result!.projects.map((p) => p.name)).toContain('Weymouth')
  })

  it('returns null for a duplicate name differing only in case, without throwing', () => {
    const w = weekspanWithProjects(['Weymouth'])
    expect(() => commitProjectCapture(w, 'weymouth')).not.toThrow()
    expect(commitProjectCapture(w, 'weymouth')).toBeNull()
    expect(commitProjectCapture(w, 'WEYMOUTH')).toBeNull()
  })

  it('returns null for an exact duplicate name, without throwing', () => {
    const w = weekspanWithProjects(['Weymouth'])
    expect(() => commitProjectCapture(w, 'Weymouth')).not.toThrow()
    expect(commitProjectCapture(w, 'Weymouth')).toBeNull()
  })

  it('does not mutate the original weekspan on a rejected (duplicate) capture', () => {
    const w = weekspanWithProjects(['Weymouth'])
    commitProjectCapture(w, 'weymouth')
    expect(w.projects).toHaveLength(1)
  })

  it('assigns different colours to successive projects while the ramp has unused entries', () => {
    let w = weekspanWithProjects([])

    const first = commitProjectCapture(w, 'Alpha')
    expect(first).not.toBeNull()
    w = first!

    const second = commitProjectCapture(w, 'Beta')
    expect(second).not.toBeNull()
    w = second!

    const [alpha, beta] = w.projects
    expect(alpha!.colorToken).not.toBe(beta!.colorToken)
  })

  it('does not strip day-words: a project literally named "thu" keeps that name', () => {
    const w = weekspanWithProjects([])
    const result = commitProjectCapture(w, 'thu')

    expect(result).not.toBeNull()
    expect(result!.projects.map((p) => p.name)).toEqual(['thu'])
  })

  it('does not strip a name that collides with an existing project name token-wise', () => {
    const w = weekspanWithProjects(['Weymouth'])
    const result = commitProjectCapture(w, 'Weymouth Renovation')

    expect(result).not.toBeNull()
    expect(result!.projects.map((p) => p.name)).toEqual(['Weymouth', 'Weymouth Renovation'])
  })
})
