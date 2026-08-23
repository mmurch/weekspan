/**
 * Cell-mutation commands: `done`, `due`, `skip`, `clear`.
 *
 * All four share one shape — resolve an item, resolve a date, replace (or
 * remove) the mark at that (item, date) cell — so they're implemented as one
 * parameterised `runCellCommand` rather than four near-duplicates. Every
 * write goes through `mutate` (see session.ts), which is what makes merge
 * conflicts surface uniformly instead of each command having to remember.
 *
 * Two invariants enforced here rather than left to weekspan-core, because they
 * are CLI-specific policy, not cell-menu semantics:
 *
 *   1. `skip` from this CLI always writes `provenance: 'deliberate'`. There is
 *      no flag to write `'auto'` — that provenance is reserved for
 *      `autoClose` during catch-up. See ARCHITECTURE.md "Auto-close" and
 *      `SkipProvenance` in weekspan-core/types.ts: an `auto` skip written by a
 *      human action would make a deliberate dodge indistinguishable from
 *      months of absence.
 *   2. `due` and `done` refuse to write onto a vacation day
 *      (`weekspan.vacationDays`), with `EXIT.CONFLICT`. `skip` and `clear`
 *      are unaffected — you can still skip or un-mark a vacation day.
 */
import type { CommandContext, Command } from '../command.js'
import type { DisplayState, IsoDate, Item, Weekspan } from '@weekspan/weekspan-core'
import { clearMark, displayState, setDone, setDue, setSkip } from '@weekspan/weekspan-core'
import { CliError, EXIT, type ExitCode } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { mutate } from '../session.js'
import { resolveItem } from '../resolve.js'
import { parseDateArg } from '../dates.js'

type CellAction = 'done' | 'due' | 'skip' | 'clear'

const USAGE: Record<CellAction, string> = {
  done: 'weekspan done <item> [date]',
  due: 'weekspan due <item> <date>',
  skip: 'weekspan skip <item> [date]',
  clear: 'weekspan clear <item> [date]',
}

/** Only `due` and `done` refuse to land on a vacation day; `skip`/`clear` don't. */
const VACATION_GUARDED: ReadonlySet<CellAction> = new Set(['due', 'done'])

const VERB: Record<Exclude<CellAction, 'clear'>, string> = {
  done: 'done',
  due: 'due',
  skip: 'skipped',
}

/** Apply one action to an item at a date. Never mutates `item`; may return the SAME reference (see marks.ts) when nothing actually changes — that's the signal a no-op write should be skipped. */
function applyAction(item: Item, date: IsoDate, action: CellAction): Item {
  switch (action) {
    case 'done':
      return setDone(item, date)
    case 'due':
      return setDue(item, date)
    case 'skip':
      // Always 'deliberate'. See module doc — there is deliberately no way
      // to plumb 'auto' through from the CLI.
      return setSkip(item, date, 'deliberate')
    case 'clear':
      return clearMark(item, date)
  }
}

function describeResult(
  action: CellAction,
  title: string,
  date: IsoDate,
  state: DisplayState,
  changed: boolean,
): string {
  const q = JSON.stringify(title)
  if (action === 'clear') {
    return changed
      ? `Cleared ${date} on ${q}. Now ${state}.`
      : `No mark on ${date} for ${q}; nothing to clear.`
  }
  const verb = VERB[action]
  return changed
    ? `Marked ${q} ${verb} on ${date}. Now ${state}.`
    : `${q} was already ${verb} on ${date}. Still ${state}.`
}

interface CellArgs {
  itemQuery: string
  dateArg: string | undefined
}

function parseCellArgs(argv: string[], action: CellAction): CellArgs {
  const [itemQuery, dateArg, ...rest] = argv
  const usage = `Usage: ${USAGE[action]}`
  if (!itemQuery) throw new CliError(`Missing item.\n${usage}`, EXIT.USAGE)
  if (action === 'due' && !dateArg) throw new CliError(`Missing date.\n${usage}`, EXIT.USAGE)
  if (rest.length > 0) throw new CliError(`Too many arguments.\n${usage}`, EXIT.USAGE)
  return { itemQuery, dateArg }
}

export interface CellResultData {
  itemId: string
  title: string
  date: IsoDate
  action: CellAction
  /** False when nothing on disk changed — either a no-op `clear`, or the mark already matched. */
  written: boolean
  state: DisplayState
}

/**
 * Shared implementation for all four commands. `out` defaults to a real
 * stdout/stderr `Output` so the registered `Command.run` needs no extra
 * wiring; tests pass their own `Output` (built via `createOutput` over
 * in-memory streams) to capture output deterministically.
 */
export async function runCellCommand(
  ctx: CommandContext,
  action: CellAction,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  try {
    const { itemQuery, dateArg } = parseCellArgs(ctx.argv, action)
    const date = parseDateArg(dateArg ?? 'today', ctx.today)

    let resolvedId = ''
    let resolvedTitle = ''
    let changed = true

    const { weekspan } = await mutate(ctx, out, (loaded: Weekspan) => {
      const item = resolveItem(loaded, itemQuery)
      resolvedId = item.id
      resolvedTitle = item.title

      if (VACATION_GUARDED.has(action) && loaded.vacationDays.includes(date)) {
        throw new CliError(
          `${date} is a vacation day; refusing to mark ${JSON.stringify(item.title)} ${action}.`,
          EXIT.CONFLICT,
        )
      }

      const updated = applyAction(item, date, action)
      if (updated === item) {
        // Structural no-op (marks.ts returns the same reference): nothing to
        // write, so `mutate` must not touch the file at all.
        changed = false
        return null
      }
      return { ...loaded, items: loaded.items.map((i) => (i.id === item.id ? updated : i)) }
    })

    const finalItem = weekspan.items.find((i) => i.id === resolvedId)
    // Present after mutate() unless the item vanished mid-flight (e.g. a
    // concurrent delete merged in) — extremely unlikely, but report state
    // honestly rather than throw on the happy path's tail.
    const state = finalItem ? displayState(finalItem, ctx.today) : 'open'
    const human = describeResult(action, resolvedTitle, date, state, changed)
    const data: CellResultData = {
      itemId: resolvedId,
      title: resolvedTitle,
      date,
      action,
      written: changed,
      state,
    }
    out.data(human, data)
    return EXIT.OK
  } catch (err) {
    if (err instanceof CliError) {
      out.error(err.message, err.code, err.detail)
      return err.code
    }
    const message = err instanceof Error ? err.message : String(err)
    out.error(message, EXIT.ERROR)
    return EXIT.ERROR
  }
}

export const doneCommand: Command = {
  name: 'done',
  summary: 'Mark an item done on a date (default: today)',
  usage: USAGE.done,
  run: (ctx) => runCellCommand(ctx, 'done'),
}

export const dueCommand: Command = {
  name: 'due',
  summary: 'Mark an item due on a date',
  usage: USAGE.due,
  run: (ctx) => runCellCommand(ctx, 'due'),
}

export const skipCommand: Command = {
  name: 'skip',
  summary: 'Mark an item skipped on a date (default: today); always deliberate provenance',
  usage: USAGE.skip,
  run: (ctx) => runCellCommand(ctx, 'skip'),
}

export const clearCommand: Command = {
  name: 'clear',
  summary: 'Clear the mark on a date (default: today)',
  usage: USAGE.clear,
  run: (ctx) => runCellCommand(ctx, 'clear'),
}
