/**
 * `ledger add | rm | edit | move` — item lifecycle.
 */
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'
import {
  minimalMoveRank,
  orderItems,
  rankForInsert,
  setDue,
  siblingsOf,
  validateRecurrence,
  type Item,
  type Ledger,
  type Recurrence,
  type RecurrenceFreq,
} from '@murch-todo/ledger-core'
import type { Command, CommandContext } from '../command.js'
import { CliError, EXIT, type ExitCode } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { mutate } from '../session.js'
import { resolveItem } from '../resolve.js'
import { parseDateArg } from '../dates.js'

/** Short, URL-safe, collision-checked against the ledger. */
function newId(ledger: Ledger): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = randomBytes(4).toString('hex').slice(0, 6)
    if (!ledger.items.some((i) => i.id === id)) return id
  }
  throw new CliError('Could not generate a unique item id.', EXIT.ERROR)
}

function buildRecurrence(
  values: Record<string, unknown>,
  today: string,
): Recurrence | undefined {
  const freq = values.recur as RecurrenceFreq | undefined
  if (!freq) return undefined

  const weekday = values.weekday === undefined ? undefined : Number(values.weekday)
  const monthday = values.monthday === undefined ? undefined : Number(values.monthday)
  const rule: Recurrence = {
    freq,
    anchor: today,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(monthday !== undefined ? { monthday } : {}),
  }
  // Validate BEFORE any write, so a bad rule fails loudly rather than producing
  // an item that silently generates no occurrences.
  try {
    validateRecurrence(rule)
  } catch (err) {
    throw new CliError(`Invalid recurrence: ${(err as Error).message}`, EXIT.USAGE)
  }
  return rule
}

/** One level of nesting only — fail before writing, not at the next parse. */
function assertParentAllowed(ledger: Ledger, parent: Item): void {
  if (parent.parentId != null) {
    throw new CliError(
      `${parent.id} is already a sub-item; nesting is one level only.`,
      EXIT.USAGE,
    )
  }
}

export async function runAdd(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args: ctx.argv,
    options: {
      due: { type: 'string' },
      project: { type: 'string' },
      parent: { type: 'string' },
      notes: { type: 'string' },
      recur: { type: 'string' },
      weekday: { type: 'string' },
      monthday: { type: 'string' },
      after: { type: 'string' },
      before: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  })

  const title = positionals.join(' ').trim()
  if (!title) throw new CliError('A title is required:  ledger add "buy milk"', EXIT.USAGE)

  let created: Item | undefined
  const result = await mutate(ctx, out, (ledger) => {
    const parent = values.parent ? resolveItem(ledger, values.parent as string) : undefined
    if (parent) assertParentAllowed(ledger, parent)

    const scope = siblingsOf(ledger.items, parent?.id ?? null)
    const after = values.after ? resolveItem(ledger, values.after as string) : undefined
    const before = values.before ? resolveItem(ledger, values.before as string) : undefined

    let rank: string
    if (after || before) {
      const anchor = after ?? before!
      const idx = scope.findIndex((i) => i.id === anchor.id)
      // The anchor must live in the SAME rank scope as the new item — ranks are
      // sibling-scoped. Without this check findIndex returns -1, `scope[idx + 1]`
      // silently resolves to `scope[0]`, and the item lands in an arbitrary
      // position (or throws a confusing RankError from deep inside rankForInsert).
      if (idx === -1) {
        throw new CliError(
          `${anchor.id} is not a sibling of the new item; --after/--before must name an item ` +
            `with the same parent.`,
          EXIT.USAGE,
        )
      }
      rank = after
        ? rankForInsert(anchor, scope[idx + 1] ?? null)
        : rankForInsert(idx > 0 ? scope[idx - 1]! : null, anchor)
    } else {
      rank = rankForInsert(scope[scope.length - 1] ?? null, null)
    }

    const recurrence = buildRecurrence(values as Record<string, unknown>, ctx.today)
    let item: Item = {
      id: newId(ledger),
      title,
      rank,
      marks: {},
      ...(values.notes ? { notes: values.notes as string } : {}),
      ...(parent ? { parentId: parent.id } : {}),
      ...(values.project ? { projectId: values.project as string } : {}),
      ...(recurrence ? { recurrence } : {}),
    }
    if (values.due) item = setDue(item, parseDateArg(values.due as string, ctx.today))

    created = item
    return { ...ledger, items: [...ledger.items, item] }
  })

  out.data(`Added ${created!.id}  ${created!.title}`, {
    id: created!.id,
    title: created!.title,
    written: result.written,
  })
  return EXIT.OK
}

export async function runRm(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args: ctx.argv,
    options: {
      force: { type: 'boolean', default: false },
      recursive: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  })
  const query = positionals[0]
  if (!query) throw new CliError('Which item?  ledger rm <item> --force', EXIT.USAGE)

  let removed: Item[] = []
  await mutate(ctx, out, (ledger) => {
    const item = resolveItem(ledger, query)
    const children = ledger.items.filter((i) => i.parentId === item.id)

    if (!values.force) {
      // --force is required in every mode, --json included: AGENTS.md documents
      // `ledger rm <item> --force` as the contract, and --json is the primary
      // interface agents drive this CLI through. Exempting --json here would make
      // the sanctioned agent path the one that deletes without confirmation.
      throw new CliError(`Refusing to delete ${item.id} without --force.`, EXIT.USAGE)
    }
    if (children.length > 0 && !values.recursive) {
      // Removing a parent alone would orphan children into a dangling parentId,
      // which makes the file fail to parse on the next load.
      throw new CliError(
        `${item.id} has ${children.length} sub-item(s). Use --recursive to remove them too.`,
        EXIT.CONFLICT,
      )
    }

    const doomed = new Set([item.id, ...children.map((c) => c.id)])
    removed = ledger.items.filter((i) => doomed.has(i.id))
    return { ...ledger, items: ledger.items.filter((i) => !doomed.has(i.id)) }
  })

  out.data(
    `Removed ${removed.length} item(s): ${removed.map((i) => i.title).join(', ')}`,
    { removed: removed.map((i) => ({ id: i.id, title: i.title })) },
  )
  return EXIT.OK
}

export async function runEdit(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args: ctx.argv,
    options: {
      title: { type: 'string' },
      notes: { type: 'string' },
      project: { type: 'string' },
      parent: { type: 'string' },
      recur: { type: 'string' },
      weekday: { type: 'string' },
      monthday: { type: 'string' },
      'no-recur': { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  })
  const query = positionals[0]
  if (!query) throw new CliError('Which item?  ledger edit <item> --title "..."', EXIT.USAGE)

  let edited: Item | undefined
  await mutate(ctx, out, (ledger) => {
    const item = resolveItem(ledger, query)
    const parent = values.parent ? resolveItem(ledger, values.parent as string) : undefined
    if (parent) assertParentAllowed(ledger, parent)

    const recurrence = buildRecurrence(values as Record<string, unknown>, ctx.today)
    const next: Item = {
      ...item,
      ...(values.title ? { title: values.title as string } : {}),
      ...(values.notes ? { notes: values.notes as string } : {}),
      ...(values.project ? { projectId: values.project as string } : {}),
      ...(parent ? { parentId: parent.id } : {}),
      ...(recurrence ? { recurrence } : {}),
      ...(values['no-recur'] ? { recurrence: null } : {}),
    }
    edited = next
    return { ...ledger, items: ledger.items.map((i) => (i.id === item.id ? next : i)) }
  })

  out.data(`Updated ${edited!.id}  ${edited!.title}`, {
    id: edited!.id,
    title: edited!.title,
  })
  return EXIT.OK
}

export async function runMove(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args: ctx.argv,
    options: { before: { type: 'string' }, after: { type: 'string' } },
    strict: false,
    allowPositionals: true,
  })
  const query = positionals[0]
  if (!query) throw new CliError('Which item?  ledger move <item> --before <other>', EXIT.USAGE)
  if (!values.before && !values.after) {
    throw new CliError('Give --before <item> or --after <item>.', EXIT.USAGE)
  }

  let moved = false
  let subject: Item | undefined
  await mutate(ctx, out, (ledger) => {
    const item = resolveItem(ledger, query)
    subject = item
    const target = resolveItem(ledger, (values.before ?? values.after) as string)
    if (target.id === item.id) {
      throw new CliError('An item cannot be moved relative to itself.', EXIT.USAGE)
    }

    // The moving item must be excluded from its own neighbour computation.
    // Otherwise `move b --after a` (with order a, b) computes `after = b`, asking
    // b to sort strictly before itself — impossible, so minimalMoveRank always
    // reported a violation and rewrote the rank on every no-op move.
    const scope = orderItems(ledger.items).filter((i) => i.id !== item.id)
    const idx = scope.findIndex((i) => i.id === target.id)

    const before = values.after ? target : idx > 0 ? scope[idx - 1]! : null
    const after = values.after ? (scope[idx + 1] ?? null) : target

    const rank = minimalMoveRank(item, before, after, ledger.items)
    // null means the constraint is ALREADY satisfied. Writing an identical file
    // just to report success would produce a pointless diff in a synced folder —
    // the no-write case is the entire point of minimalMoveRank.
    if (rank === null) return null

    moved = true
    return {
      ...ledger,
      items: ledger.items.map((i) => (i.id === item.id ? { ...i, rank } : i)),
    }
  })

  out.data(
    moved ? `Moved ${subject!.id}.` : `${subject!.id} is already in position; nothing written.`,
    { id: subject!.id, moved },
  )
  return EXIT.OK
}

export const addCommand: Command = {
  name: 'add',
  summary: 'Add an item',
  usage: 'ledger add "<title>" [--due <date>] [--project <id>] [--parent <item>] [--recur weekly --weekday 1]',
  run: (ctx) => runAdd(ctx),
}
export const rmCommand: Command = {
  name: 'rm',
  summary: 'Remove an item',
  usage: 'ledger rm <item> --force [--recursive]',
  run: (ctx) => runRm(ctx),
}
export const editCommand: Command = {
  name: 'edit',
  summary: 'Edit an item',
  usage: 'ledger edit <item> [--title <t>] [--notes <n>] [--project <id>] [--no-recur]',
  run: (ctx) => runEdit(ctx),
}
export const moveCommand: Command = {
  name: 'move',
  summary: 'Reorder an item',
  usage: 'ledger move <item> --before <other> | --after <other>',
  run: (ctx) => runMove(ctx),
}
