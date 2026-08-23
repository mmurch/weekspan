import type { IsoDate, Project } from '@weekspan/weekspan-core'
import { parseCapture } from './capture.js'

const today: IsoDate = '2026-08-26' // Wednesday

const projects: Project[] = [
  { id: 'proj-weymouth', name: 'Weymouth ground floor', colorToken: 'barA' },
  { id: 'proj-work', name: 'Work', colorToken: 'barB' },
  { id: 'proj-weekend', name: 'Weekend trip', colorToken: 'barC' },
]

describe('parseCapture', () => {
  it('resolves the design example: title, due day-word, and project prefix', () => {
    const c = parseCapture('order tile samples thu weymouth', projects, today)

    expect(c.title).toBe('order tile samples')
    expect(c.due).toBe('2026-08-27') // next Thursday on/after 2026-08-26
    expect(c.projectId).toBe('proj-weymouth')
  })

  it('tokenizes thu as due and weymouth as project, spans lining up with the input', () => {
    const input = 'order tile samples thu weymouth'
    const c = parseCapture(input, projects, today)

    for (const t of c.tokens) {
      expect(input.slice(t.start, t.end)).toBe(t.value)
    }

    const due = c.tokens.find((t) => t.kind === 'due')!
    expect(due.value).toBe('thu')
    expect(input.slice(due.start, due.end)).toBe('thu')

    const project = c.tokens.find((t) => t.kind === 'project')!
    expect(project.value).toBe('weymouth')
    expect(input.slice(project.start, project.end)).toBe('weymouth')
  })

  it('resolves "wed" to TODAY on a Wednesday (inclusive), not next week', () => {
    const c = parseCapture('stand-up notes wed', projects, today)
    expect(c.due).toBe(today)
  })

  it('resolves "today" and "tomorrow"', () => {
    expect(parseCapture('call the plumber today', projects, today).due).toBe('2026-08-26')
    expect(parseCapture('call the plumber tomorrow', projects, today).due).toBe('2026-08-27')
  })

  it('resolves a relative offset like +3d', () => {
    const c = parseCapture('renew library book +3d', projects, today)
    expect(c.due).toBe('2026-08-29')
  })

  it('resolves a relative week offset like -1w', () => {
    const c = parseCapture('follow up -1w', projects, today)
    expect(c.due).toBe('2026-08-19')
  })

  it('matches a project by exact name, case-insensitively', () => {
    const c = parseCapture('finish deck WORK', projects, today)
    expect(c.projectId).toBe('proj-work')
    expect(c.title).toBe('finish deck')
  })

  it('matches a project by a unique case-insensitive prefix', () => {
    const c = parseCapture('order samples Weymo', projects, today)
    expect(c.projectId).toBe('proj-weymouth')
    expect(c.title).toBe('order samples')
  })

  it('does not match an ambiguous prefix, leaving the word in the title', () => {
    // "we" is a prefix of BOTH "Weymouth ground floor" and "Weekend trip".
    const c = parseCapture('plan the we trip', projects, today)
    expect(c.projectId).toBeUndefined()
    expect(c.title).toBe('plan the we trip')
    const weToken = c.tokens.find((t) => t.value === 'we')!
    expect(weToken.kind).toBe('text')
  })

  it('only the LAST due token wins when several appear', () => {
    const c = parseCapture('reschedule mon then actually fri', projects, today)
    // mon -> 2026-08-31 (next Monday), fri -> 2026-08-28 (next Friday); fri appears last.
    expect(c.due).toBe('2026-08-28')
    // Both are still tokenized as due for highlighting purposes.
    const dueTokens = c.tokens.filter((t) => t.kind === 'due')
    expect(dueTokens.map((t) => t.value)).toEqual(['mon', 'fri'])
  })

  it('yields a plain title with no tokens beyond text when nothing resolves', () => {
    const c = parseCapture('buy milk and eggs', projects, today)
    expect(c.title).toBe('buy milk and eggs')
    expect(c.due).toBeUndefined()
    expect(c.projectId).toBeUndefined()
    expect(c.tokens.every((t) => t.kind === 'text')).toBe(true)
  })

  it('handles an empty input', () => {
    const c = parseCapture('', projects, today)
    expect(c.title).toBe('')
    expect(c.tokens).toEqual([])
    expect(c.due).toBeUndefined()
    expect(c.projectId).toBeUndefined()
  })

  it('accepts an explicit ISO date as a due token', () => {
    const c = parseCapture('pay invoice 2026-09-01', projects, today)
    expect(c.due).toBe('2026-09-01')
    expect(c.title).toBe('pay invoice')
  })
})
