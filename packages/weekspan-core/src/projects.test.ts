import type { Item, Project, Weekspan } from './types.js'
import { createWeekspan } from './weekspan.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'
import {
  PROJECT_COLOR_TOKENS,
  addProject,
  assignProject,
  findProjectByName,
  nextProjectColor,
  removeProject,
  renameProject,
  setProjectColor,
} from './projects.js'

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    title: 'Item',
    rank: 'V',
    marks: {},
    ...over,
  }
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Work',
    colorToken: 'barA',
    ...over,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('PROJECT_COLOR_TOKENS', () => {
  it('is barA..barF', () => {
    expect(PROJECT_COLOR_TOKENS).toEqual(['barA', 'barB', 'barC', 'barD', 'barE', 'barF'])
  })
})

describe('addProject', () => {
  it('creates a project and returns its id', () => {
    const weekspan = createWeekspan()
    const { weekspan: result, id } = addProject(weekspan, 'Work')

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]).toEqual({ id, name: 'Work', colorToken: 'barA' })
    expect(id).toMatch(/^[0-9a-z]{7}$/)
  })

  it('defaults colorToken to nextProjectColor when omitted', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ id: 'p1', colorToken: 'barA' })] })
    const { weekspan: result } = addProject(weekspan, 'Home')
    expect(result.projects.find((p) => p.name === 'Home')?.colorToken).toBe('barB')
  })

  it('accepts an explicit colorToken', () => {
    const weekspan = createWeekspan()
    const { weekspan: result } = addProject(weekspan, 'Work', 'barD')
    expect(result.projects[0]!.colorToken).toBe('barD')
  })

  it('trims the stored name', () => {
    const weekspan = createWeekspan()
    const { weekspan: result } = addProject(weekspan, '  Work  ')
    expect(result.projects[0]!.name).toBe('Work')
  })

  it('throws on a blank name', () => {
    const weekspan = createWeekspan()
    expect(() => addProject(weekspan, '')).toThrow(/blank/)
    expect(() => addProject(weekspan, '   ')).toThrow(/blank/)
  })

  it('throws on a case-insensitive duplicate name', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    expect(() => addProject(weekspan, 'work')).toThrow(/already exists/)
    expect(() => addProject(weekspan, 'WORK')).toThrow(/already exists/)
  })

  it('throws on an invalid explicit colorToken', () => {
    const weekspan = createWeekspan()
    expect(() => addProject(weekspan, 'Work', 'not-a-token')).toThrow(/color token/)
  })

  it('generates unique ids across many calls', () => {
    let weekspan = createWeekspan()
    const ids = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const { weekspan: next, id } = addProject(weekspan, `Project ${i}`)
      expect(ids.has(id)).toBe(false)
      ids.add(id)
      weekspan = next
    }
    expect(ids.size).toBe(200)
  })

  it('never mutates the input weekspan', () => {
    const weekspan = deepFreeze(createWeekspan({ projects: [makeProject()] }))
    expect(() => addProject(weekspan, 'Home')).not.toThrow()
    expect(weekspan.projects).toEqual([{ id: 'p1', name: 'Work', colorToken: 'barA' }])
  })
})

describe('renameProject', () => {
  it('renames a project', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    const result = renameProject(weekspan, 'p1', 'Job')
    expect(result?.projects[0]!.name).toBe('Job')
  })

  it('trims the new name', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    const result = renameProject(weekspan, 'p1', '  Job  ')
    expect(result?.projects[0]!.name).toBe('Job')
  })

  it('returns null for an unchanged name', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    expect(renameProject(weekspan, 'p1', 'Work')).toBeNull()
    expect(renameProject(weekspan, 'p1', '  Work  ')).toBeNull()
  })

  it('allows a case-only change (not treated as a no-op or a duplicate)', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    const result = renameProject(weekspan, 'p1', 'WORK')
    expect(result).not.toBeNull()
    expect(result?.projects[0]!.name).toBe('WORK')
  })

  it('returns null for an unknown project id', () => {
    const weekspan = createWeekspan({ projects: [makeProject()] })
    expect(renameProject(weekspan, 'nope', 'New Name')).toBeNull()
  })

  it('throws on a blank name', () => {
    const weekspan = createWeekspan({ projects: [makeProject()] })
    expect(() => renameProject(weekspan, 'p1', '   ')).toThrow(/blank/)
  })

  it('throws on a case-insensitive duplicate of a different project', () => {
    const weekspan = createWeekspan({
      projects: [makeProject({ id: 'p1', name: 'Work' }), makeProject({ id: 'p2', name: 'Home' })],
    })
    expect(() => renameProject(weekspan, 'p2', 'work')).toThrow(/already exists/)
  })

  it('never mutates the input weekspan', () => {
    const weekspan = deepFreeze(createWeekspan({ projects: [makeProject({ name: 'Work' })] }))
    expect(() => renameProject(weekspan, 'p1', 'Job')).not.toThrow()
    expect(weekspan.projects[0]!.name).toBe('Work')
  })
})

describe('setProjectColor', () => {
  it('sets a project color', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ colorToken: 'barA' })] })
    const result = setProjectColor(weekspan, 'p1', 'barC')
    expect(result?.projects[0]!.colorToken).toBe('barC')
  })

  it('returns null for an unchanged color', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ colorToken: 'barA' })] })
    expect(setProjectColor(weekspan, 'p1', 'barA')).toBeNull()
  })

  it('returns null for an unknown project id', () => {
    const weekspan = createWeekspan({ projects: [makeProject()] })
    expect(setProjectColor(weekspan, 'nope', 'barB')).toBeNull()
  })

  it('throws on an invalid color token', () => {
    const weekspan = createWeekspan({ projects: [makeProject()] })
    expect(() => setProjectColor(weekspan, 'p1', 'not-a-token')).toThrow(/color token/)
  })

  it('never mutates the input weekspan', () => {
    const weekspan = deepFreeze(createWeekspan({ projects: [makeProject({ colorToken: 'barA' })] }))
    expect(() => setProjectColor(weekspan, 'p1', 'barC')).not.toThrow()
    expect(weekspan.projects[0]!.colorToken).toBe('barA')
  })
})

describe('removeProject', () => {
  it('removes the project', () => {
    const weekspan = createWeekspan({ projects: [makeProject()] })
    const result = removeProject(weekspan, 'p1')
    expect(result?.projects).toEqual([])
  })

  it('unassigns every item that pointed at the removed project, leaving no dangling projectId', () => {
    const weekspan = createWeekspan({
      projects: [makeProject({ id: 'p1' })],
      items: [
        makeItem({ id: 'i1', projectId: 'p1' }),
        makeItem({ id: 'i2', projectId: 'p1' }),
        makeItem({ id: 'i3', projectId: null }),
      ],
    })

    const result = removeProject(weekspan, 'p1')
    expect(result).not.toBeNull()
    expect(result?.items.every((i) => i.projectId !== 'p1')).toBe(true)
    expect(result?.items.find((i) => i.id === 'i1')?.projectId).toBeNull()
    expect(result?.items.find((i) => i.id === 'i2')?.projectId).toBeNull()

    // The strict parser refuses a dangling projectId — this is the real
    // assertion that removal didn't corrupt the file.
    expect(() => parse(serialize(result as Weekspan))).not.toThrow()
  })

  it('leaves items pointing at OTHER projects untouched', () => {
    const weekspan = createWeekspan({
      projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2', name: 'Home' })],
      items: [makeItem({ id: 'i1', projectId: 'p2' })],
    })
    const result = removeProject(weekspan, 'p1')
    expect(result?.items[0]!.projectId).toBe('p2')
  })

  it('returns null for an unknown project id', () => {
    const weekspan = createWeekspan({ projects: [makeProject()] })
    expect(removeProject(weekspan, 'nope')).toBeNull()
  })

  it('never mutates the input weekspan', () => {
    const weekspan = deepFreeze(
      createWeekspan({ projects: [makeProject()], items: [makeItem({ projectId: 'p1' })] }),
    )
    expect(() => removeProject(weekspan, 'p1')).not.toThrow()
    expect(weekspan.projects).toHaveLength(1)
    expect(weekspan.items[0]!.projectId).toBe('p1')
  })
})

describe('assignProject', () => {
  it('assigns an item to a project', () => {
    const weekspan = createWeekspan({
      projects: [makeProject()],
      items: [makeItem({ projectId: null })],
    })
    const result = assignProject(weekspan, 'i1', 'p1')
    expect(result?.items[0]!.projectId).toBe('p1')
  })

  it('unassigns with null', () => {
    const weekspan = createWeekspan({
      projects: [makeProject()],
      items: [makeItem({ projectId: 'p1' })],
    })
    const result = assignProject(weekspan, 'i1', null)
    expect(result?.items[0]!.projectId).toBeNull()
  })

  it('returns null for an unknown item id', () => {
    const weekspan = createWeekspan({ projects: [makeProject()], items: [makeItem()] })
    expect(assignProject(weekspan, 'nope', 'p1')).toBeNull()
  })

  it('returns null for an unknown project id', () => {
    const weekspan = createWeekspan({ items: [makeItem()] })
    expect(assignProject(weekspan, 'i1', 'nope')).toBeNull()
  })

  it('returns null when the item already has that project', () => {
    const weekspan = createWeekspan({
      projects: [makeProject()],
      items: [makeItem({ projectId: 'p1' })],
    })
    expect(assignProject(weekspan, 'i1', 'p1')).toBeNull()
  })

  it('returns null when unassigning an already-unassigned item', () => {
    const weekspan = createWeekspan({ items: [makeItem({ projectId: null })] })
    expect(assignProject(weekspan, 'i1', null)).toBeNull()
  })

  it('never mutates the input weekspan', () => {
    const weekspan = deepFreeze(
      createWeekspan({ projects: [makeProject()], items: [makeItem({ projectId: null })] }),
    )
    expect(() => assignProject(weekspan, 'i1', 'p1')).not.toThrow()
    expect(weekspan.items[0]!.projectId).toBeNull()
  })
})

describe('findProjectByName', () => {
  it('finds a project case-insensitively', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    expect(findProjectByName(weekspan, 'work')).toEqual(makeProject({ name: 'Work' }))
    expect(findProjectByName(weekspan, 'WORK')).toEqual(makeProject({ name: 'Work' }))
    expect(findProjectByName(weekspan, 'Work')).toEqual(makeProject({ name: 'Work' }))
  })

  it('returns undefined when no project matches', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    expect(findProjectByName(weekspan, 'Home')).toBeUndefined()
  })

  it('does not partial-match', () => {
    const weekspan = createWeekspan({ projects: [makeProject({ name: 'Work' })] })
    expect(findProjectByName(weekspan, 'Wor')).toBeUndefined()
    expect(findProjectByName(weekspan, 'Work Trip')).toBeUndefined()
  })
})

describe('nextProjectColor', () => {
  it('returns the first ramp token when there are no projects', () => {
    const weekspan = createWeekspan()
    expect(nextProjectColor(weekspan)).toBe('barA')
  })

  it('spreads across the ramp before repeating any token', () => {
    let weekspan = createWeekspan()
    const seen: string[] = []
    for (let i = 0; i < PROJECT_COLOR_TOKENS.length; i++) {
      const token = nextProjectColor(weekspan)
      seen.push(token)
      const { weekspan: next } = addProject(weekspan, `Project ${i}`, token)
      weekspan = next
    }
    expect(new Set(seen).size).toBe(PROJECT_COLOR_TOKENS.length)
    expect(seen).toEqual(PROJECT_COLOR_TOKENS)
  })

  it('still returns a valid ramp token once every token has been used', () => {
    const weekspan = createWeekspan({
      projects: PROJECT_COLOR_TOKENS.map((token, i) => makeProject({ id: `p${i}`, colorToken: token })),
    })
    const next = nextProjectColor(weekspan)
    expect(PROJECT_COLOR_TOKENS).toContain(next)
  })

  it('picks the least-used token, breaking ties by ramp order', () => {
    const weekspan = createWeekspan({
      projects: [
        makeProject({ id: 'p1', colorToken: 'barA' }),
        makeProject({ id: 'p2', colorToken: 'barA' }),
        makeProject({ id: 'p3', colorToken: 'barB' }),
      ],
    })
    // barA used twice, barB once, barC..F unused (tied at zero) -> barC wins the tie.
    expect(nextProjectColor(weekspan)).toBe('barC')
  })
})
