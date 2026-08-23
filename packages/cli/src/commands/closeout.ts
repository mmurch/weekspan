/**
 * `ledger close-out` — close the oldest unclosed week.
 */
import { parseArgs } from 'node:util'
import {
  autoClose,
  closeWeek,
  isCloseable,
  oldestUnclosedWeek,
  weekOf,
  weeksBetween,
  type ArchiveFile,
  type Ledger,
} from '@murch-todo/ledger-core'
import type { Command, CommandContext } from '../command.js'
import { CliError, EXIT, type ExitCode } from '../exit.js'
import { loadLedger, saveLedger, writeArchive } from '../io.js'
import { createOutput, type Output } from '../output.js'

export async function runCloseOut(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const { values } = parseArgs({
    args: ctx.argv,
    options: { auto: { type: 'boolean', default: false } },
    strict: false,
    allowPositionals: true,
  })

  const loaded = await loadLedger(ctx.ledgerPath)
  return values.auto
    ? runAuto(ctx, out, loaded)
    : runSingle(ctx, out, loaded)
}

type Loaded = Awaited<ReturnType<typeof loadLedger>>

async function runSingle(ctx: CommandContext, out: Output, loaded: Loaded): Promise<ExitCode> {
  const ledger = loaded.ledger
  const week = oldestUnclosedWeek(ledger, ctx.today)

  if (weeksBetween(week, weekOf(ctx.today)) <= 0) {
    throw new CliError(
      `${week} is the current week and cannot be closed until it is in the past.`,
      EXIT.CONFLICT,
    )
  }

  const check = isCloseable(ledger, week, ctx.today)
  if (!check.closeable) {
    const explicit = check.blockers.filter((b) => b.kind === 'explicit')
    const generated = check.blockers.filter((b) => b.kind === 'generated')
    const lines = [`${week} cannot close yet:`]
    for (const b of explicit) {
      lines.push(`  due    ${b.date}  ${b.title} (${b.itemId}) — complete or clear it`)
    }
    for (const b of generated) {
      lines.push(`  recurs ${b.date}  ${b.title} (${b.itemId}) — skip it, or run close-out --auto`)
    }
    throw new CliError(lines.join('\n'), EXIT.CONFLICT, {
      week,
      blockers: { explicit, generated },
    })
  }

  const { ledger: next, archive } = closeWeek(ledger, week, ctx.today)

  // ORDER MATTERS: archive first, then the trimmed ledger. If the process dies
  // between the two, an orphaned archive file is recoverable — a ledger with
  // items removed and no archive written is permanent data loss.
  const archivePath = await writeArchive(ctx.ledgerPath, archive)
  const saved = await saveLedger(loaded, next)
  reportConflicts(out, saved, ctx.ledgerPath)

  const stayed = next.items.length
  out.data(
    [
      `Closed ${week}.`,
      `Archived ${archive.items.length} item(s) to ${archivePath}.`,
      // Said explicitly because recurring items are NEVER archived, and a user
      // who does not know that will assume they were lost.
      `${stayed} item(s) remain in the ledger (recurring items never archive).`,
    ].join('\n'),
    {
      week,
      archived: archive.items.map((i) => ({ id: i.id, title: i.title })),
      archivePath,
      remaining: stayed,
    },
  )
  return EXIT.OK
}

async function runAuto(ctx: CommandContext, out: Output, loaded: Loaded): Promise<ExitCode> {
  const result = autoClose(loaded.ledger, ctx.today)

  if (result.weeksClosed.length === 0) {
    out.data('Nothing to close.', { weeksClosed: [], autoSkipped: 0, archives: [] })
    return EXIT.OK
  }

  const paths: string[] = []
  for (const archive of result.archives as ArchiveFile[]) {
    paths.push(await writeArchive(ctx.ledgerPath, archive))
  }
  const saved = await saveLedger(loaded, result.ledger as Ledger)
  reportConflicts(out, saved, ctx.ledgerPath)

  out.data(
    [
      `Closed ${result.weeksClosed.length} week(s): ${result.weeksClosed.join(', ')}`,
      `Auto-skipped ${result.autoSkipped} recurring occurrence(s).`,
      paths.length ? `Archives: ${paths.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    {
      weeksClosed: result.weeksClosed,
      autoSkipped: result.autoSkipped,
      archives: paths,
    },
  )
  return EXIT.OK
}

function reportConflicts(
  out: Output,
  saved: { merged: boolean; conflicts: Array<{ itemId: string | null; field: string }> },
  ledgerPath: string,
): void {
  if (saved.merged) {
    out.warn(`Another writer changed ${ledgerPath} during close-out; changes were merged.`)
  }
  for (const c of saved.conflicts) {
    out.warn(`Conflict on ${c.itemId ? `${c.itemId} ` : ''}${c.field}: kept this session's value.`)
  }
}

export const closeOutCommand: Command = {
  name: 'close-out',
  summary: 'Close the oldest unclosed week (--auto to catch up)',
  usage: 'ledger close-out [--auto]',
  run: (ctx) => runCloseOut(ctx),
}
