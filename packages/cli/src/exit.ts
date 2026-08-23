/**
 * Exit codes.
 *
 * Distinct codes per failure class because agents branch on them. A single
 * catch-all `1` would force an agent to parse stderr prose to decide whether to
 * retry, fix its input, or give up — which is exactly the brittle coupling this
 * CLI exists to avoid.
 */
export const EXIT = {
  OK: 0,
  /** Something unexpected. Reserved for genuinely unclassified failures. */
  ERROR: 1,
  /** Bad arguments, unknown command, unparseable date, ambiguous item. Retry with different input. */
  USAGE: 2,
  /** The action was refused for a domain reason: week not closeable, merge conflicts, vacation day. */
  CONFLICT: 3,
  /** The weekspan file is missing, unreadable, malformed, or written by a newer version. */
  FILE: 4,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/** Thrown to abort a command with a specific exit code and a human-readable reason. */
export class CliError extends Error {
  override name = 'CliError'
  constructor(
    message: string,
    readonly code: ExitCode = EXIT.ERROR,
    /** Optional structured payload surfaced under --json. */
    readonly detail?: unknown,
  ) {
    super(message)
  }
}
