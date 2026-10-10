import type { Weekspan } from '@weekspan/weekspan-core'
import type { CommandContext } from './command.js'
import { EXIT, type ExitCode } from './exit.js'
import { loadWeekspan, saveWeekspan } from './io.js'
import type { Output } from './output.js'

/**
 * The single path every mutating command takes.
 *
 * It exists so that surfacing merge conflicts is STRUCTURAL rather than something
 * each command has to remember. `MergeResult.conflicts` had no consumer until the
 * CLI; if reporting them were left to individual commands, one forgetful command
 * would silently discard another device's edit — invisibly, and with no way for
 * the user to discover it later.
 *
 * `apply` returns the next weekspan, or `null` to mean "nothing to do". Returning
 * null writes nothing at all: no file touch, no mtime change, no diff in a synced
 * folder. `minimalMoveRank` returning null is exactly this case.
 */
export async function mutate(
  ctx: CommandContext,
  out: Output,
  apply: (weekspan: Weekspan) => Weekspan | null,
): Promise<{ code: ExitCode; weekspan: Weekspan; written: boolean }> {
  const loaded = await loadWeekspan(ctx.weekspanPath)
  const next = apply(loaded.weekspan)

  if (next === null) {
    return { code: EXIT.OK, weekspan: loaded.weekspan, written: false }
  }

  const result = await saveWeekspan(loaded, next)

  if (result.merged) {
    out.warn(
      `Another writer changed ${ctx.weekspanPath} while this command ran; changes were merged.`,
    )
  }

  for (const c of result.conflicts) {
    // Named individually rather than counted: "3 conflicts" tells the user nothing
    // actionable, and this resolves toward OUR value, so the other side's edit is
    // gone unless they can see exactly what it was.
    const where = c.itemId ? `${c.itemId} ${c.field}` : c.field
    out.warn(
      `Conflict on ${where}: kept ${JSON.stringify(c.ours)}, discarded ${JSON.stringify(c.theirs)}`,
    )
  }

  if (result.ranksRepaired > 0) {
    // Both sides added an item at the same position and computed the same key.
    // Nothing is lost, but the merge moved a row, so say so.
    out.warn(
      `${result.ranksRepaired} item(s) were given a fresh rank: both writers inserted at the same position.`,
    )
  }

  return { code: EXIT.OK, weekspan: result.written ? next : loaded.weekspan, written: result.written }
}

/** Read-only load, for commands that never write. */
export async function read(ctx: CommandContext): Promise<Weekspan> {
  return (await loadWeekspan(ctx.weekspanPath)).weekspan
}
