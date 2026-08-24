import { parseDateWord, tryParseDateWord } from '@weekspan/weekspan-core'
import type { IsoDate } from '@weekspan/weekspan-core'
import { CliError, EXIT } from './exit.js'

/**
 * Turns a user/agent-supplied date argument into an `IsoDate`.
 *
 * The vocabulary itself (ISO dates, today/tomorrow/yesterday, weekday names,
 * +3d/-1w offsets) lives in `@weekspan/weekspan-core`'s `datewords` module —
 * shared with the web app's quick-capture — so an agent typing `thu` through
 * the CLI and a person typing `thu` in quick-capture always agree. This module
 * only adapts that shared parser to the CLI's exit-code contract: a bad
 * argument must fail with `CliError(..., EXIT.USAGE)`, not a plain `Error`.
 */
export function parseDateArg(input: string, today: IsoDate): IsoDate {
  try {
    return parseDateWord(input, today)
  } catch (e) {
    throw new CliError((e as Error).message, EXIT.USAGE)
  }
}

export function tryParseDateArg(input: string, today: IsoDate): IsoDate | undefined {
  return tryParseDateWord(input, today)
}
