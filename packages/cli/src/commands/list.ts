/**
 * `weekspan list` — the working set, in display order.
 *
 * Read-only: never calls `mutate`, never writes.
 */
import {
  computeWindow,
  displayState,
  effectiveMark,
  orderItems,
  allWeekDates,
  windowDateRange,
  type IsoDate,
  type Item,
  type Weekspan,
} from '@weekspan/weekspan-core'
import { parseArgs } from 'node:util'
import type { Command, CommandContext } from '../command.js'
import { EXIT, type ExitCode } from '../exit.js'
import { createOutput, type Output } from '../output.js'
import { read } from '../session.js'
import { parseDateArg } from '../dates.js'

interface ListFilters {
  project: string | undefined
  open: boolean
  done: boolean
  week: string | undefined
  dueBefore: IsoDate | undefined
}

function parse(ctx: CommandContext): ListFilters {
  const { values } = parseArgs({
    args: ctx.argv,
    options: {
      project: { type: 'string' },
      open: { type: 'boolean', default: false },
      done: { type: 'boolean', default: false },
      week: { type: 'string' },
      'due-before': { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  })
  const dueBefore = values['due-before'] as string | undefined
  return {
    project: values.project as string | undefined,
    open: Boolean(values.open),
    done: Boolean(values.done),
    week: values.week as string | undefined,
    dueBefore: dueBefore ? parseDateArg(dueBefore, ctx.today) : undefined,
  }
}

/** Dates an item shows a mark on within `dates`, explicit or generated. */
function marksIn(item: Item, dates: IsoDate[]): Array<{ date: IsoDate; kind: string }> {
  const out: Array<{ date: IsoDate; kind: string }> = []
  for (const date of dates) {
    const mark = effectiveMark(item, date)
    if (mark) out.push({ date, kind: mark.kind })
  }
  return out
}

function keep(item: Item, f: ListFilters, today: IsoDate, dates: IsoDate[]): boolean {
  if (f.project !== undefined && (item.projectId ?? null) !== f.project) return false

  const state = displayState(item, today)
  if (f.open && state !== 'open') return false
  if (f.done && state !== 'finished') return false

  if (f.dueBefore !== undefined) {
    const hasEarlierDue = dates.some(
      (d) => d < f.dueBefore! && effectiveMark(item, d)?.kind === 'due',
    )
    if (!hasEarlierDue) return false
  }
  return true
}

export async function runList(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const filters = parse(ctx)
  const weekspan: Weekspan = await read(ctx)
  const window = computeWindow(weekspan, ctx.today)

  // Which dates to inspect for marks. `--week` narrows to one block; otherwise
  // the whole visible window, so a recurring item always shows something.
  const range = windowDateRange(window)
  // allWeekDates (Mon-Sun), NOT weekdayDates (Mon-Fri). Close-out scans the full
  // seven days, so a Saturday due blocks the week from closing — and showing only
  // weekdays here meant `list --week` hid the very mark `status` was reporting as
  // the blocker, leaving the user no way to find what to clear.
  const dates: IsoDate[] = filters.week
    ? allWeekDates(filters.week)
    : datesBetween(range.from, range.to)

  const ordered = orderItems(weekspan.items)
  const rows = ordered
    .filter((i) => keep(i, filters, ctx.today, dates))
    .map((item) => ({
      id: item.id,
      title: item.title,
      state: displayState(item, ctx.today),
      indent: item.parentId == null ? 0 : 1,
      projectId: item.projectId ?? null,
      recurring: Boolean(item.recurrence),
      marks: marksIn(item, dates),
    }))

  const human =
    rows.length === 0
      ? 'No matching items.'
      : rows
          .map((r) => {
            const pad = '  '.repeat(r.indent)
            const marks = r.marks.map((m) => `${m.date} ${m.kind}`).join(', ')
            const styled = out.style(r.state, `${pad}${r.title}`)
            return `${r.id.padEnd(8)} ${styled}${marks ? `\n${' '.repeat(9)}${pad}${marks}` : ''}`
          })
          .join('\n')

  out.data(human, { items: rows, window: { from: window.from, to: window.to } })
  return EXIT.OK
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    const d = new Date(`${cur}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    cur = d.toISOString().slice(0, 10)
  }
  return out
}

export const listCommand: Command = {
  name: 'list',
  summary: 'List items in priority order',
  usage: 'weekspan list [--project <id>] [--open|--done] [--week <YYYY-Www>] [--due-before <date>]',
  run: (ctx) => runList(ctx),
}
