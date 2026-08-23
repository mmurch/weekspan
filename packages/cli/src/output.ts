/**
 * The one rendering surface every command goes through.
 *
 * Two audiences, two contracts:
 *   - Human mode: readable text, coloured if the terminal supports it.
 *   - `--json` mode: exactly one JSON object per invocation on stdout, meant
 *     to be piped into `jq` or parsed by an agent.
 *
 * The rule that makes both safe to combine: DATA goes to stdout, DIAGNOSTICS
 * (warnings, the human-readable half of an error) go to stderr, and the two
 * streams are never interleaved on purpose. `ledger list --json | jq` must
 * keep working even when a command also calls `warn()` — a warning landing
 * on stdout would corrupt the agent's parse. See `warn()` and the tests
 * below for the regression this guards against.
 */
import type { Writable } from 'node:stream'
import type { DisplayState } from '@murch-todo/ledger-core'
import { rowStyle } from '@murch-todo/ledger-core'
import type { ExitCode } from './exit.js'

export interface OutputOptions {
  /** `--json` was passed: emit the machine envelope instead of prose. */
  json: boolean
  /**
   * Whether to emit ANSI styling. Decided ONCE by the caller (typically via
   * `shouldUseColor`) and passed in — never sniffed inside `Output` itself,
   * so tests get deterministic output regardless of what TTY they run under.
   */
  color: boolean
  stdout: Writable
  stderr: Writable
}

/** The envelope every `--json` success response uses. Stable shape — see module doc. */
export interface SuccessEnvelope<T = unknown> {
  ok: true
  data: T
}

/** The envelope every `--json` failure response uses. */
export interface ErrorEnvelope {
  ok: false
  error: {
    code: ExitCode
    message: string
    detail?: unknown
  }
}

export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope

export interface Output {
  /**
   * The result of a command. `human` renders in default mode, `json` renders
   * (as `{ ok: true, data: json }`) under `--json`. Always stdout.
   */
  data(human: string, json: unknown): void
  /** A non-fatal heads-up. ALWAYS stderr, in both modes — never pollutes the data stream. */
  warn(message: string): void
  /**
   * A fatal problem. The human message always goes to stderr. Under `--json`
   * an `ErrorEnvelope` is ALSO written to stdout, so a piped consumer still
   * gets exactly one JSON object rather than nothing.
   */
  error(message: string, code: ExitCode, detail?: unknown): void
  /** Human-mode-only helper: an aligned, padded table. No-ops under `--json`. */
  table(rows: string[][], headers?: string[]): void
  /**
   * Render `text` the way `state` should read in human mode, using
   * ledger-core's `rowStyle` rather than reinventing the finished/skipped/open
   * distinction. Always prefixes a plain-text marker so the three states stay
   * distinguishable even with colour off — the only signal an agent or a
   * piped `less` ever sees. Applies ANSI on top only when this `Output` was
   * created with `color: true`; per the module doc, skipped NEVER gets the
   * strikethrough sequence.
   */
  style(state: DisplayState, text: string): string
}

const MARKER: Record<DisplayState, string> = {
  finished: '✓', // check mark
  skipped: '~',
  open: ' ',
}

const ESC = '\x1b'
const SGR_ITALIC = '3'
const SGR_DIM = '2'
const SGR_STRIKETHROUGH = '9'
const ANSI_RESET = `${ESC}[0m`

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function applyStyle(state: DisplayState, text: string, color: boolean): string {
  const marker = MARKER[state]
  const marked = `${marker} ${text}`
  if (!color) return marked

  const style = rowStyle(state)
  const codes: string[] = []
  if (style.strikethrough) codes.push(SGR_STRIKETHROUGH)
  if (style.italic) codes.push(SGR_ITALIC)
  if (style.deemphasized) codes.push(SGR_DIM)
  if (codes.length === 0) return marked

  return `${ESC}[${codes.join(';')}m${marked}${ANSI_RESET}`
}

function renderTable(rows: string[][], headers: string[] | undefined): string {
  const allRows = headers ? [headers, ...rows] : rows
  const widths: number[] = []
  for (const row of allRows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, stripAnsi(cell).length)
    })
  }

  const pad = (cell: string, width: number) => cell + ' '.repeat(Math.max(0, width - stripAnsi(cell).length))
  const renderRow = (row: string[]) =>
    row.map((cell, i) => (i === row.length - 1 ? cell : pad(cell, widths[i] ?? 0))).join('  ')

  const lines: string[] = []
  if (headers) {
    lines.push(renderRow(headers))
    lines.push(widths.map((w) => '-'.repeat(w)).join('  '))
  }
  for (const row of rows) lines.push(renderRow(row))
  return lines.join('\n')
}

/**
 * Colour policy, factored out so it's independently testable and so
 * `createOutput` has somewhere pure to call it exactly once.
 *
 * `NO_COLOR` wins even when set to the empty string: presence is what
 * counts, not value (see no-color.org).
 */
export function shouldUseColor(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env.NO_COLOR !== undefined) return false
  return isTTY
}

export function createOutput(opts: Partial<OutputOptions> = {}): Output {
  const json = opts.json ?? false
  const stdout = opts.stdout ?? process.stdout
  const stderr = opts.stderr ?? process.stderr
  const color = opts.color ?? shouldUseColor(process.env, Boolean((stdout as NodeJS.WriteStream).isTTY))

  const writeLine = (stream: Writable, line: string): void => {
    stream.write(line.endsWith('\n') ? line : `${line}\n`)
  }

  return {
    data(human, jsonValue) {
      if (json) {
        const envelope: SuccessEnvelope = { ok: true, data: jsonValue }
        writeLine(stdout, JSON.stringify(envelope))
      } else {
        writeLine(stdout, human)
      }
    },

    warn(message) {
      writeLine(stderr, `Warning: ${message}`)
    },

    error(message, code, detail) {
      writeLine(stderr, message)
      if (json) {
        const envelope: ErrorEnvelope = {
          ok: false,
          error: detail === undefined ? { code, message } : { code, message, detail },
        }
        writeLine(stdout, JSON.stringify(envelope))
      }
    },

    table(rows, headers) {
      if (json) return
      if (rows.length === 0 && !headers) return
      writeLine(stdout, renderTable(rows, headers))
    },

    style(state, text) {
      return applyStyle(state, text, color)
    },
  }
}
