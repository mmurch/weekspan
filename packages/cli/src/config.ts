import { homedir } from 'node:os'
import path from 'node:path'
import { CliError, EXIT } from './exit.js'

/**
 * Where the weekspan lives.
 *
 * Resolution order, most explicit first:
 *   1. `--weekspan <path>`   — explicit, wins over everything
 *   2. `WEEKSPAN_FILE` env   — how agents and scripts will usually point at one
 *   3. `~/.weekspanrc`       — a single line holding a path
 *   4. `~/todo/personal.weekspan.json` — conventional default
 *
 * Deliberately NOT a search up the current directory tree. This weekspan normally
 * lives in a synced folder (Drive, Dropbox) far from wherever a command happens
 * to be run, so cwd carries no signal — and a cwd-sensitive default would make
 * the same command write to different files depending on where it was invoked.
 */
export const DEFAULT_WEEKSPAN = path.join(homedir(), 'todo', 'personal.weekspan.json')
export const RC_FILE = path.join(homedir(), '.weekspanrc')

export interface ResolveOptions {
  flag?: string | undefined
  env?: string | undefined
  rcContents?: string | undefined
}

/** Pure so it can be tested without touching the filesystem or environment. */
export function resolveWeekspanPath(opts: ResolveOptions): string {
  const fromRc = opts.rcContents?.trim().split('\n')[0]?.trim()
  const chosen = opts.flag ?? opts.env ?? (fromRc || undefined) ?? DEFAULT_WEEKSPAN

  if (chosen.trim() === '') {
    throw new CliError('Weekspan path is empty. Pass --weekspan <path> or set WEEKSPAN_FILE.', EXIT.USAGE)
  }
  return path.resolve(expandHome(chosen))
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2))
  return p
}

/** Directory holding the weekspan — where `archive/` and `weekspan.schema.json` live. */
export function weekspanDir(weekspanPath: string): string {
  return path.dirname(weekspanPath)
}

export function archiveDir(weekspanPath: string): string {
  return path.join(weekspanDir(weekspanPath), 'archive')
}

export function schemaPath(weekspanPath: string): string {
  return path.join(weekspanDir(weekspanPath), 'weekspan.schema.json')
}
