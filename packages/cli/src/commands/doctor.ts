/**
 * `weekspan doctor` — check the ledger for repairable damage, and with `--fix`,
 * repair it.
 *
 * This exists because there was nowhere to put a repair. When two items ended up
 * sharing a rank, the only ways out were hand-editing the JSON (which the file's
 * own `$agent` warning tells you not to do, and which cannot generate a valid
 * fractional key anyway) or pasting a script into a browser console. Neither is
 * a thing to ask of someone whose quick capture just stopped working.
 *
 * Deliberately narrow: it reports only what it can actually fix. `parse` already
 * rejects everything structurally wrong (dangling parents, bad ranks, unknown
 * keys), so anything that loads at all is either healthy or has a duplicate
 * rank. A "doctor" that also listed things it could not act on would just be a
 * second, worse `status`.
 */
import { orderItems, repairDuplicateRanks, type Weekspan } from '@weekspan/weekspan-core'
import type { Command, CommandContext } from '../command.js'
import { EXIT, type ExitCode } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { mutate, read } from '../session.js'
import { parseArgs } from 'node:util'

export async function runDoctor(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const { values } = parseArgs({ args: ctx.argv, options: { fix: { type: 'boolean' } }, strict: false })
  const fix = values.fix === true

  const before: Weekspan = await read(ctx)
  const { repairs } = repairDuplicateRanks(before.items)
  const titleOf = (id: string): string => before.items.find((i) => i.id === id)?.title ?? id

  if (repairs.length === 0) {
    out.data('No problems found.', { healthy: true, duplicateRanks: [], fixed: false })
    return EXIT.OK
  }

  const lines = [
    `${repairs.length} item(s) share a rank with a sibling.`,
    'Ordering still renders, but inserting between the affected rows fails.',
    '',
    ...repairs.map((r) => `  ${r.id}  ${JSON.stringify(titleOf(r.id))}  ${r.from} -> ${r.to}`),
  ]

  if (!fix) {
    lines.push('', 'Run `weekspan doctor --fix` to repair. Display order will not change.')
    out.data(lines.join('\n'), { healthy: false, duplicateRanks: repairs, fixed: false })
    // Non-zero so an agent (or a CI check) can gate on it without parsing prose.
    return EXIT.CONFLICT
  }

  const result = await mutate(ctx, out, (w) => {
    const repaired = repairDuplicateRanks(w.items)
    // Re-run against the freshly loaded copy rather than reusing the diagnosis:
    // `mutate` merges, and the file may have moved since the read above.
    return repaired.repairs.length === 0 ? null : { ...w, items: repaired.items }
  })

  // Proof rather than assertion: every adjacent pair must now be a usable
  // insert anchor, which is the property that was actually broken.
  const roots = orderItems(result.weekspan.items)
  const stillColliding = roots.filter((item, i) => i > 0 && roots[i - 1]!.rank >= item.rank).length

  lines.push('', `Repaired ${repairs.length} rank(s).`)
  if (stillColliding > 0) lines.push(`WARNING: ${stillColliding} collision(s) remain.`)

  out.data(lines.join('\n'), {
    healthy: stillColliding === 0,
    duplicateRanks: repairs,
    fixed: result.written,
  })
  return stillColliding === 0 ? EXIT.OK : EXIT.ERROR
}

export const doctorCommand: Command = {
  name: 'doctor',
  summary: 'Check the ledger for repairable damage (--fix to repair)',
  usage: 'weekspan doctor [--fix] [--json]',
  run: (ctx) => runDoctor(ctx),
}
