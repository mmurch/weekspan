import { homedir } from 'node:os'
import path from 'node:path'
import { CliError, EXIT } from './exit.js'

/**
 * Where the ledger lives.
 *
 * Resolution order, most explicit first:
 *   1. `--ledger <path>`   — explicit, wins over everything
 *   2. `LEDGER_FILE` env   — how agents and scripts will usually point at one
 *   3. `~/.ledgerrc`       — a single line holding a path
 *   4. `~/todo/personal.ledger.json` — conventional default
 *
 * Deliberately NOT a search up the current directory tree. This ledger normally
 * lives in a synced folder (Drive, Dropbox) far from wherever a command happens
 * to be run, so cwd carries no signal — and a cwd-sensitive default would make
 * the same command write to different files depending on where it was invoked.
 */
export const DEFAULT_LEDGER = path.join(homedir(), 'todo', 'personal.ledger.json')
export const RC_FILE = path.join(homedir(), '.ledgerrc')

export interface ResolveOptions {
  flag?: string | undefined
  env?: string | undefined
  rcContents?: string | undefined
}

/** Pure so it can be tested without touching the filesystem or environment. */
export function resolveLedgerPath(opts: ResolveOptions): string {
  const fromRc = opts.rcContents?.trim().split('\n')[0]?.trim()
  const chosen = opts.flag ?? opts.env ?? (fromRc || undefined) ?? DEFAULT_LEDGER

  if (chosen.trim() === '') {
    throw new CliError('Ledger path is empty. Pass --ledger <path> or set LEDGER_FILE.', EXIT.USAGE)
  }
  return path.resolve(expandHome(chosen))
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2))
  return p
}

/** Directory holding the ledger — where `archive/` and `ledger.schema.json` live. */
export function ledgerDir(ledgerPath: string): string {
  return path.dirname(ledgerPath)
}

export function archiveDir(ledgerPath: string): string {
  return path.join(ledgerDir(ledgerPath), 'archive')
}

export function schemaPath(ledgerPath: string): string {
  return path.join(ledgerDir(ledgerPath), 'ledger.schema.json')
}
