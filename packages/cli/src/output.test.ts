import { Writable } from 'node:stream'
import { EXIT } from './exit.js'
import { createOutput, shouldUseColor } from './output.js'
import type { ErrorEnvelope, SuccessEnvelope } from './output.js'

/** In-memory sink so tests never touch the real process streams. */
function memoryStream(): { stream: Writable; text(): string; lines(): string[] } {
  let buf = ''
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString()
      cb()
    },
  })
  return {
    stream,
    text: () => buf,
    lines: () => buf.split('\n').filter((l) => l.length > 0),
  }
}

const ANSI_RE = /\x1b\[[0-9;]*m/

describe('data()', () => {
  it('human mode writes the human string to stdout and nothing to stderr', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: false, color: false, stdout: out.stream, stderr: err.stream })

    output.data('2 items open', { count: 2 })

    expect(out.text()).toBe('2 items open\n')
    expect(err.text()).toBe('')
  })

  it('json mode emits exactly one line of valid JSON to stdout and nothing to stderr', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: true, color: false, stdout: out.stream, stderr: err.stream })

    output.data('2 items open', { count: 2 })

    expect(out.lines()).toHaveLength(1)
    const parsed = JSON.parse(out.lines()[0] as string) as SuccessEnvelope
    expect(parsed).toEqual({ ok: true, data: { count: 2 } })
    expect(err.text()).toBe('')
  })
})

describe('warn()', () => {
  it('always writes to stderr, never stdout', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: false, color: false, stdout: out.stream, stderr: err.stream })

    output.warn('something looked odd')

    expect(out.text()).toBe('')
    expect(err.text()).toContain('something looked odd')
  })

  it('during a --json run, a warning leaves stdout parseable (the piping regression)', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: true, color: false, stdout: out.stream, stderr: err.stream })

    output.warn('week already closed once')
    output.data('done', { ok: true })

    // stdout must still be exactly one JSON line — the warning must not have landed there.
    expect(out.lines()).toHaveLength(1)
    expect(() => JSON.parse(out.lines()[0] as string)).not.toThrow()
    expect(err.text()).toContain('week already closed once')
  })
})

describe('error()', () => {
  it('human mode writes the message to stderr and nothing to stdout', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: false, color: false, stdout: out.stream, stderr: err.stream })

    output.error('week is not closeable', EXIT.CONFLICT)

    expect(out.text()).toBe('')
    expect(err.text()).toContain('week is not closeable')
  })

  it('json mode emits the error envelope on stdout with the right code, and the message on stderr', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: true, color: false, stdout: out.stream, stderr: err.stream })

    output.error('week is not closeable', EXIT.CONFLICT, { unresolved: ['abc123'] })

    expect(out.lines()).toHaveLength(1)
    const parsed = JSON.parse(out.lines()[0] as string) as ErrorEnvelope
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe(EXIT.CONFLICT)
    expect(parsed.error.message).toBe('week is not closeable')
    expect(parsed.error.detail).toEqual({ unresolved: ['abc123'] })
    expect(err.text()).toContain('week is not closeable')
  })

  it('json mode omits the detail key entirely when none is given', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: true, color: false, stdout: out.stream, stderr: err.stream })

    output.error('bad weekspan path', EXIT.USAGE)

    const parsed = JSON.parse(out.lines()[0] as string) as ErrorEnvelope
    expect('detail' in parsed.error).toBe(false)
  })
})

describe('shouldUseColor', () => {
  it('is false when NO_COLOR is set, even to the empty string', () => {
    expect(shouldUseColor({ NO_COLOR: '1' }, true)).toBe(false)
    expect(shouldUseColor({ NO_COLOR: '' }, true)).toBe(false)
  })

  it('is false when not a TTY', () => {
    expect(shouldUseColor({}, false)).toBe(false)
  })

  it('is true when a TTY and NO_COLOR is unset', () => {
    expect(shouldUseColor({}, true)).toBe(true)
  })
})

describe('style() — rendering derived state', () => {
  it('finished is struck through when colour is on', () => {
    const output = createOutput({ color: true, stdout: memoryStream().stream, stderr: memoryStream().stream })
    const text = output.style('finished', 'Buy milk')
    expect(text).toMatch(ANSI_RE)
    expect(text).toContain('\x1b[9') // strikethrough SGR code present somewhere in the sequence
  })

  it('skipped is italic and dimmed but NEVER strikethrough, when colour is on', () => {
    const output = createOutput({ color: true, stdout: memoryStream().stream, stderr: memoryStream().stream })
    const text = output.style('skipped', 'Go for a run')
    expect(text).toMatch(ANSI_RE)
    expect(text).not.toContain('\x1b[9')
    expect(text).not.toMatch(/\x1b\[[0-9;]*9[0-9;]*m/) // no variant of the code embeds a 9 either
  })

  it('skipped contains no strikethrough sequence in no-colour mode either (and no ANSI at all)', () => {
    const output = createOutput({ color: false, stdout: memoryStream().stream, stderr: memoryStream().stream })
    const text = output.style('skipped', 'Go for a run')
    expect(text).not.toMatch(ANSI_RE)
    expect(text).not.toContain('\x1b[9')
  })

  it('uses a plain-text marker so states are distinguishable with no colour at all', () => {
    const output = createOutput({ color: false, stdout: memoryStream().stream, stderr: memoryStream().stream })
    const finished = output.style('finished', 'A')
    const skipped = output.style('skipped', 'A')
    const open = output.style('open', 'A')

    expect(finished).not.toMatch(ANSI_RE)
    expect(skipped).not.toMatch(ANSI_RE)
    expect(open).not.toMatch(ANSI_RE)
    // three distinct markers, none of them relying on styling
    expect(new Set([finished, skipped, open]).size).toBe(3)
  })
})

describe('no ANSI leaks when colour is disabled', () => {
  it('data(), table(), and style() are all clean of escape bytes', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: false, color: false, stdout: out.stream, stderr: err.stream })

    output.data(output.style('finished', 'Buy milk'), { title: 'Buy milk' })
    output.table(
      [
        [output.style('open', 'Write report'), '2026-08-24'],
        [output.style('skipped', 'Go for a run'), '2026-08-23'],
      ],
      ['Title', 'Date'],
    )

    expect(out.text()).not.toMatch(ANSI_RE)
    expect(out.text()).not.toContain('\x1b')
  })
})

describe('table()', () => {
  it('no-ops entirely under --json (never writes to stdout)', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: true, color: false, stdout: out.stream, stderr: err.stream })

    output.table([['a', 'b']], ['H1', 'H2'])

    expect(out.text()).toBe('')
  })

  it('pads columns to align, and keeps headers above a separator rule', () => {
    const out = memoryStream()
    const err = memoryStream()
    const output = createOutput({ json: false, color: false, stdout: out.stream, stderr: err.stream })

    output.table(
      [
        ['x', 'short'],
        ['a longer title', 'y'],
      ],
      ['Title', 'Notes'],
    )

    const lines = out.text().split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(4) // header, rule, 2 rows
    expect(lines[0]).toBe('Title           Notes')
    expect(lines[1]).toBe('--------------  -----')
    expect(lines[2]).toBe('x               short')
    expect(lines[3]).toBe('a longer title  y')
  })
})
