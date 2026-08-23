import { homedir } from 'node:os'
import path from 'node:path'
import { DEFAULT_LEDGER, archiveDir, ledgerDir, resolveLedgerPath, schemaPath } from './config.js'
import { CliError } from './exit.js'

describe('resolveLedgerPath', () => {
  it('prefers the explicit flag over everything', () => {
    expect(
      resolveLedgerPath({ flag: '/a/flag.json', env: '/b/env.json', rcContents: '/c/rc.json' }),
    ).toBe('/a/flag.json')
  })

  it('falls back to the env var, then the rc file, then the default', () => {
    expect(resolveLedgerPath({ env: '/b/env.json', rcContents: '/c/rc.json' })).toBe('/b/env.json')
    expect(resolveLedgerPath({ rcContents: '/c/rc.json' })).toBe('/c/rc.json')
    expect(resolveLedgerPath({})).toBe(DEFAULT_LEDGER)
  })

  it('reads only the first line of the rc file and trims it', () => {
    expect(resolveLedgerPath({ rcContents: '  /c/rc.json  \n# a comment\n' })).toBe('/c/rc.json')
  })

  it('ignores an empty or whitespace-only rc file rather than resolving to nothing', () => {
    expect(resolveLedgerPath({ rcContents: '   \n' })).toBe(DEFAULT_LEDGER)
    expect(resolveLedgerPath({ rcContents: '' })).toBe(DEFAULT_LEDGER)
  })

  it('expands a leading ~', () => {
    expect(resolveLedgerPath({ flag: '~/todo/work.json' })).toBe(
      path.join(homedir(), 'todo', 'work.json'),
    )
  })

  it('returns an absolute path even when given a relative one', () => {
    expect(path.isAbsolute(resolveLedgerPath({ flag: 'rel.json' }))).toBe(true)
  })

  it('rejects an explicitly empty path rather than silently using the default', () => {
    expect(() => resolveLedgerPath({ flag: '   ' })).toThrow(CliError)
  })
})

describe('sibling paths', () => {
  it('derives archive and schema locations from the ledger directory', () => {
    const p = '/home/me/Dropbox/personal.ledger.json'
    expect(ledgerDir(p)).toBe('/home/me/Dropbox')
    expect(archiveDir(p)).toBe('/home/me/Dropbox/archive')
    expect(schemaPath(p)).toBe('/home/me/Dropbox/ledger.schema.json')
  })
})
