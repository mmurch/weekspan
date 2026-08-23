import type { IsoDate } from '@murch-todo/ledger-core'
import type { ExitCode } from './exit.js'

/**
 * Everything a command is given. Note `today` is resolved ONCE by the dispatcher
 * and passed down, never read from the clock inside a command — mirroring
 * ledger-core, where every date-dependent function takes `today` as an argument.
 * That is what makes the whole stack deterministically testable.
 */
export interface CommandContext {
  /** Absolute path to the ledger file. Resolved by `config.ts`. */
  ledgerPath: string
  /** True when `--json` was passed: emit machine output, never prompt. */
  json: boolean
  today: IsoDate
  /** Arguments after the subcommand name. */
  argv: string[]
}

export interface Command {
  name: string
  /** One line, shown in `ledger --help`. */
  summary: string
  /** Usage string, shown in `ledger help <name>`. */
  usage: string
  run(ctx: CommandContext): Promise<ExitCode>
}
