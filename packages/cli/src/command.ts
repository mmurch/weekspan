import type { IsoDate } from '@weekspan/weekspan-core'
import type { ExitCode } from './exit.js'

/**
 * Everything a command is given. Note `today` is resolved ONCE by the dispatcher
 * and passed down, never read from the clock inside a command — mirroring
 * weekspan-core, where every date-dependent function takes `today` as an argument.
 * That is what makes the whole stack deterministically testable.
 */
export interface CommandContext {
  /** Absolute path to the weekspan file. Resolved by `config.ts`. */
  weekspanPath: string
  /** True when `--json` was passed: emit machine output, never prompt. */
  json: boolean
  today: IsoDate
  /** Arguments after the subcommand name. */
  argv: string[]
}

export interface Command {
  name: string
  /** One line, shown in `weekspan --help`. */
  summary: string
  /** Usage string, shown in `weekspan help <name>`. */
  usage: string
  run(ctx: CommandContext): Promise<ExitCode>
}
