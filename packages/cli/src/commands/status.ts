/**
 * `ledger status` — "what do I need to do to move forward?"
 *
 * Read-only. The one command an agent should call first to orient itself.
 */
import {
  computeWindow,
  displayState,
  isCloseable,
  type Ledger,
} from '@murch-todo/ledger-core'
import type { Command, CommandContext } from '../command.js'
import { EXIT, type ExitCode } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { read } from '../session.js'

export async function runStatus(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const ledger: Ledger = await read(ctx)
  const window = computeWindow(ledger, ctx.today)
  const oldest = window.weeks.find((w) => w.isOldestUnclosed)

  const counts = { open: 0, finished: 0, skipped: 0, recurring: 0 }
  for (const item of ledger.items) {
    if (item.recurrence) counts.recurring++
    counts[displayState(item, ctx.today)]++
  }

  // Blockers are split by kind because they need DIFFERENT actions: an explicit
  // due must be done or cleared; a generated recurring occurrence needs a skip
  // or `close-out --auto`. Reporting them identically would leave the user
  // unable to tell what to actually do next.
  let closeable = false
  let explicit: Array<{ itemId: string; date: string; title: string }> = []
  let generated: Array<{ itemId: string; date: string; title: string }> = []

  if (oldest && oldest.isPast) {
    const result = isCloseable(ledger, oldest.week, ctx.today)
    closeable = result.closeable
    explicit = result.blockers
      .filter((b) => b.kind === 'explicit')
      .map((b) => ({ itemId: b.itemId, date: b.date, title: b.title }))
    generated = result.blockers
      .filter((b) => b.kind === 'generated')
      .map((b) => ({ itemId: b.itemId, date: b.date, title: b.title }))
  }

  const lines: string[] = []
  lines.push(`Today ${ctx.today} (${window.currentWeek})`)
  lines.push(`Window ${window.from} .. ${window.to} (${window.weeks.length} weeks)`)
  lines.push(
    `${counts.open} open · ${counts.finished} finished · ${counts.skipped} skipped · ${counts.recurring} recurring`,
  )

  if (!oldest || !oldest.isPast) {
    lines.push('No past week awaiting close-out.')
  } else if (closeable) {
    lines.push(`${oldest.week} is ready to close:  ledger close-out`)
  } else {
    lines.push(`${oldest.week} cannot close yet:`)
    for (const b of explicit) {
      lines.push(`  due    ${b.date}  ${b.title}  (${b.itemId}) — complete or clear it`)
    }
    for (const b of generated) {
      lines.push(`  recurs ${b.date}  ${b.title}  (${b.itemId}) — skip it, or run close-out --auto`)
    }
  }

  out.data(lines.join('\n'), {
    today: ctx.today,
    currentWeek: window.currentWeek,
    window: { from: window.from, to: window.to, weeks: window.weeks.map((w) => w.week) },
    counts,
    oldestUnclosedWeek: oldest?.week ?? null,
    closeable,
    blockers: { explicit, generated },
  })
  return EXIT.OK
}

export const statusCommand: Command = {
  name: 'status',
  summary: 'Show the window, counts, and what blocks close-out',
  usage: 'ledger status [--json]',
  run: (ctx) => runStatus(ctx),
}
