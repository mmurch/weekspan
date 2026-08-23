import type { Item, Ledger } from '@murch-todo/ledger-core'
import { CliError, EXIT } from './exit.js'

/**
 * Find the item a user or agent meant.
 *
 * Exact id always wins. Otherwise we match on title, case-insensitively, preferring
 * a prefix match over a substring match — typing the start of a task is the common
 * human case, and letting a substring beat it would make short queries surprising.
 *
 * An ambiguous query is an ERROR listing the candidates, never a guess. Silently
 * acting on the wrong task is the worst failure this CLI can have: `ledger done proj`
 * quietly completing the wrong row is both invisible and, once the week closes,
 * effectively permanent. Agents should pass ids; the fuzzy path is for humans.
 */
export function resolveItem(ledger: Ledger, query: string): Item {
  const q = query.trim()
  if (q === '') throw new CliError('No item given.', EXIT.USAGE)

  const byId = ledger.items.find((i) => i.id === q)
  if (byId) return byId

  const lower = q.toLowerCase()
  const prefix = ledger.items.filter((i) => i.title.toLowerCase().startsWith(lower))
  const candidates =
    prefix.length > 0
      ? prefix
      : ledger.items.filter((i) => i.title.toLowerCase().includes(lower))

  if (candidates.length === 1) return candidates[0]!

  if (candidates.length === 0) {
    throw new CliError(`No item matching ${JSON.stringify(query)}.`, EXIT.USAGE)
  }

  const list = candidates
    .slice(0, 10)
    .map((i) => `  ${i.id}  ${i.title}`)
    .join('\n')
  const more = candidates.length > 10 ? `\n  ...and ${candidates.length - 10} more` : ''
  throw new CliError(
    `${JSON.stringify(query)} matches ${candidates.length} items. Use an id:\n${list}${more}`,
    EXIT.USAGE,
    { matches: candidates.map((i) => ({ id: i.id, title: i.title })) },
  )
}
