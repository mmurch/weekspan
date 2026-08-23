/**
 * `ledger init` — see e2e.test.ts for the fixture style this copies:
 * `mkdtempSync` temp dir, `capture()` over `PassThrough` streams, `ctx()`
 * builder.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { SCHEMA_VERSION, parse } from '@murch-todo/ledger-core'
import type { CommandContext } from '../command.js'
import { EXIT } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { runInit } from './init.js'

const TODAY = '2026-08-26' // Wednesday, 2026-W35

let dir: string
let ledgerPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ledger-init-'))
  ledgerPath = path.join(dir, 'l.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

interface Captured {
  out: Output
  stdout: () => string
  stderr: () => string
}

function capture(json = false): Captured {
  const o = new PassThrough()
  const e = new PassThrough()
  let outBuf = ''
  let errBuf = ''
  o.on('data', (c) => (outBuf += c.toString()))
  e.on('data', (c) => (errBuf += c.toString()))
  return {
    out: createOutput({ json, color: false, stdout: o, stderr: e }),
    stdout: () => outBuf,
    stderr: () => errBuf,
  }
}

function ctx(argv: string[], json = false): CommandContext {
  return { ledgerPath, json, today: TODAY, argv }
}

describe('creates the ledger and its companions', () => {
  it('writes the ledger, ledger.schema.json, AGENTS.md and CLAUDE.md', async () => {
    const c = capture()
    await runInit(ctx([]), c.out)

    expect(existsSync(ledgerPath)).toBe(true)
    expect(existsSync(path.join(dir, 'ledger.schema.json'))).toBe(true)
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true)

    expect(c.stdout()).toContain(`Created ${ledgerPath}`)
    expect(c.stdout()).toContain('ledger.schema.json')
    expect(c.stdout()).toContain('AGENTS.md')
    expect(c.stdout()).toContain('CLAUDE.md')
  })

  it('reports the same facts under --json', async () => {
    const c = capture(true)
    await runInit(ctx([], true), c.out)
    const data = JSON.parse(c.stdout()).data
    expect(data.created).toBe(ledgerPath)
    expect(data.schema).toBe(path.join(dir, 'ledger.schema.json'))
    expect(data.docs.sort()).toEqual(
      [path.join(dir, 'AGENTS.md'), path.join(dir, 'CLAUDE.md')].sort(),
    )
  })
})

describe('refuses to overwrite an existing ledger', () => {
  it('throws a CliError with EXIT.CONFLICT and writes nothing new', async () => {
    await runInit(ctx([]), capture().out)
    const before = readFileSync(ledgerPath, 'utf8')

    await expect(runInit(ctx([]), capture().out)).rejects.toMatchObject({
      name: 'CliError',
      code: EXIT.CONFLICT,
    })
    await expect(runInit(ctx([]), capture().out)).rejects.toThrow(/already exists/)

    expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
  })
})

describe('never clobbers existing docs', () => {
  it('leaves a pre-existing AGENTS.md untouched while still creating CLAUDE.md', async () => {
    const customAgents = '# My own instructions\n\nDo not touch this file.\n'
    writeFileSync(path.join(dir, 'AGENTS.md'), customAgents, 'utf8')

    await runInit(ctx([]), capture().out)

    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(customAgents)
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true)
  })
})

describe('the created ledger', () => {
  it('parses cleanly via ledger-core and carries the current SCHEMA_VERSION', async () => {
    await runInit(ctx([]), capture().out)
    const text = readFileSync(ledgerPath, 'utf8')
    const ledger = parse(text)
    expect(ledger.version).toBe(SCHEMA_VERSION)
    expect(ledger.items).toEqual([])
    expect(ledger.closedThrough).toBeNull()
  })
})

describe('positional path argument', () => {
  it('overrides the context ledger path', async () => {
    const customPath = path.join(dir, 'custom.ledger.json')
    await runInit(ctx([customPath]), capture().out)

    expect(existsSync(customPath)).toBe(true)
    expect(existsSync(ledgerPath)).toBe(false)
    // Companion docs land beside the CUSTOM path, not the context path.
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true)
  })
})
