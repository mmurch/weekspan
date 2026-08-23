/**
 * Entry point and subcommand dispatcher.
 *
 * Arg parsing uses `node:util`'s `parseArgs` rather than a library: this is a tool
 * agents install transiently via `npx`, so install weight is a real cost, and the
 * subcommand surface is small enough that a switch is clearer than a framework.
 *
 * Distribution is an esbuild bundle (`npm run build`). `weekspan-core` exports
 * TypeScript source rather than compiled JS — good for vitest and for the web app's
 * bundler, but not directly runnable by node — so bundling resolves that at build
 * time instead of forcing a two-stage compile or a `tsx` runtime dependency.
 */
import { parseArgs } from 'node:util'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Command, CommandContext } from './command.js'
import { CliError, EXIT, type ExitCode } from './exit.js'
import { RC_FILE, resolveWeekspanPath } from './config.js'
import { createOutput } from './output.js'
import { initCommand } from './commands/init.js'
import { listCommand } from './commands/list.js'
import { statusCommand } from './commands/status.js'
import { addCommand, editCommand, moveCommand, rmCommand } from './commands/items.js'
import { clearCommand, doneCommand, dueCommand, skipCommand } from './commands/cells.js'
import { closeOutCommand } from './commands/closeout.js'

const COMMANDS = new Map<string, Command>()

export function register(command: Command): void {
  COMMANDS.set(command.name, command)
}

for (const c of [
  initCommand,
  listCommand,
  statusCommand,
  addCommand,
  rmCommand,
  editCommand,
  moveCommand,
  doneCommand,
  dueCommand,
  skipCommand,
  clearCommand,
  closeOutCommand,
]) {
  register(c)
}

/**
 * Remove global flags from a command's own argv.
 *
 * Commands parse with `strict: false` so they can ignore flags they do not know.
 * But an undeclared `--weekspan /path` does not vanish — parseArgs hands the VALUE
 * back as a positional, so `weekspan add "buy milk" --weekspan ~/x.json` created an
 * item titled "buy milk /Users/me/x.json". Stripping globals here means every
 * command sees only its own arguments, and global flags work in any position.
 */
const VALUED_GLOBALS = new Set(['--weekspan', '--today'])
const BOOLEAN_GLOBALS = new Set(['--json'])

export function stripGlobals(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (BOOLEAN_GLOBALS.has(arg)) continue
    if (VALUED_GLOBALS.has(arg)) {
      i++ // also drop its value
      continue
    }
    // `--weekspan=/path` form.
    if ([...VALUED_GLOBALS, ...BOOLEAN_GLOBALS].some((g) => arg.startsWith(`${g}=`))) continue
    out.push(arg)
  }
  return out
}

function todayIso(now: Date): string {
  // Local calendar date, not UTC: "today" must mean the user's today. weekspan-core
  // does its arithmetic in UTC, but the *choice* of which day it is now is local.
  const y = String(now.getFullYear()).padStart(4, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function readRc(): string | undefined {
  try {
    return readFileSync(RC_FILE, 'utf8')
  } catch {
    return undefined
  }
}

function helpText(): string {
  const lines = ['weekspan — personal TODO weekspan', '', 'Usage: weekspan <command> [options]', '', 'Commands:']
  for (const c of [...COMMANDS.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`  ${c.name.padEnd(12)} ${c.summary}`)
  }
  lines.push('', 'Global options:')
  lines.push('  --weekspan <path>  Weekspan file (else $WEEKSPAN_FILE, ~/.weekspanrc, ~/todo/personal.weekspan.json)')
  lines.push('  --json           Machine-readable output on stdout')
  lines.push('  --today <date>   Override today, for testing')
  lines.push('  --help           Show this help')
  return lines.join('\n')
}

export async function main(argv: string[], now = new Date()): Promise<ExitCode> {
  const commandName = argv.find((a) => !a.startsWith('-'))

  if (!commandName || argv.includes('--help') || argv.includes('-h')) {
    // Help goes to stdout when explicitly asked for, stderr when it is an error.
    const asked = Boolean(commandName === undefined || argv.includes('--help') || argv.includes('-h'))
    if (asked && commandName === undefined && !argv.includes('--help') && !argv.includes('-h')) {
      process.stderr.write(helpText() + '\n')
      return EXIT.USAGE
    }
    process.stdout.write(helpText() + '\n')
    return EXIT.OK
  }

  const command = COMMANDS.get(commandName)
  if (!command) {
    process.stderr.write(`Unknown command: ${commandName}\n\n${helpText()}\n`)
    return EXIT.USAGE
  }

  const rest = stripGlobals(argv.slice(argv.indexOf(commandName) + 1))

  let globals
  try {
    globals = parseArgs({
      args: argv,
      options: {
        weekspan: { type: 'string' },
        json: { type: 'boolean', default: false },
        today: { type: 'string' },
      },
      strict: false,
      allowPositionals: true,
    })
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    return EXIT.USAGE
  }

  try {
    const ctx: CommandContext = {
      weekspanPath: resolveWeekspanPath({
        flag: globals.values.weekspan as string | undefined,
        env: process.env.WEEKSPAN_FILE,
        rcContents: readRc(),
      }),
      json: Boolean(globals.values.json),
      today: (globals.values.today as string | undefined) ?? todayIso(now),
      argv: rest,
    }
    return await command.run(ctx)
  } catch (err) {
    // Under --json a thrown CliError must still produce an envelope on stdout,
    // or a piped agent receives nothing at all and cannot tell a failure from a
    // crash. `createOutput` handles writing to both streams correctly.
    const json = Boolean(globals.values.json)
    const out = createOutput({ json })
    if (err instanceof CliError) {
      out.error(err.message, err.code, err.detail)
      return err.code
    }
    out.error(`Unexpected error: ${(err as Error).message}`, EXIT.ERROR)
    return EXIT.ERROR
  }
}

// Only run when invoked as a binary, so tests can import `main` freely.
// realpath both sides so a symlinked bin (which is exactly how npm installs one)
// still compares equal.
function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
