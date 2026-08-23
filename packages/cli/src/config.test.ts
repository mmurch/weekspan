import { homedir } from 'node:os'
import path from 'node:path'
import { DEFAULT_WEEKSPAN, archiveDir, weekspanDir, resolveWeekspanPath, schemaPath } from './config.js'
import { CliError } from './exit.js'

describe('resolveWeekspanPath', () => {
  it('prefers the explicit flag over everything', () => {
    expect(
      resolveWeekspanPath({ flag: '/a/flag.json', env: '/b/env.json', rcContents: '/c/rc.json' }),
    ).toBe('/a/flag.json')
  })

  it('falls back to the env var, then the rc file, then the default', () => {
    expect(resolveWeekspanPath({ env: '/b/env.json', rcContents: '/c/rc.json' })).toBe('/b/env.json')
    expect(resolveWeekspanPath({ rcContents: '/c/rc.json' })).toBe('/c/rc.json')
    expect(resolveWeekspanPath({})).toBe(DEFAULT_WEEKSPAN)
  })

  it('reads only the first line of the rc file and trims it', () => {
    expect(resolveWeekspanPath({ rcContents: '  /c/rc.json  \n# a comment\n' })).toBe('/c/rc.json')
  })

  it('ignores an empty or whitespace-only rc file rather than resolving to nothing', () => {
    expect(resolveWeekspanPath({ rcContents: '   \n' })).toBe(DEFAULT_WEEKSPAN)
    expect(resolveWeekspanPath({ rcContents: '' })).toBe(DEFAULT_WEEKSPAN)
  })

  it('expands a leading ~', () => {
    expect(resolveWeekspanPath({ flag: '~/todo/work.json' })).toBe(
      path.join(homedir(), 'todo', 'work.json'),
    )
  })

  it('returns an absolute path even when given a relative one', () => {
    expect(path.isAbsolute(resolveWeekspanPath({ flag: 'rel.json' }))).toBe(true)
  })

  it('rejects an explicitly empty path rather than silently using the default', () => {
    expect(() => resolveWeekspanPath({ flag: '   ' })).toThrow(CliError)
  })
})

describe('sibling paths', () => {
  it('derives archive and schema locations from the weekspan directory', () => {
    const p = '/home/me/Dropbox/personal.weekspan.json'
    expect(weekspanDir(p)).toBe('/home/me/Dropbox')
    expect(archiveDir(p)).toBe('/home/me/Dropbox/archive')
    expect(schemaPath(p)).toBe('/home/me/Dropbox/weekspan.schema.json')
  })
})
