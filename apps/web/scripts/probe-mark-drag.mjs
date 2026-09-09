/**
 * Mark-drag probe — dragging a DUE / ✓ / SKIP chip.
 *
 * The two halves of the gesture are unit-tested (`markDrag.test.ts` for the
 * column geometry and the write, `dragPreview.test.ts` for the row order), but
 * neither can cover what makes this feature work or not: the POINTER WIRING in
 * `useDragPreview`. Specifically —
 *
 *   - that both axes resolve from the same pointer position every frame, so a
 *     diagonal drag is one motion rather than two gestures fighting;
 *   - that the preview draws the chip on the hovered column before release;
 *   - that a chip which was merely CLICKED still cycles, because the
 *     click-swallowing after a drag is guarded on having actually moved;
 *   - that the whole gesture is ONE write, so one Ctrl+Z reverses all of it;
 *   - that holding at the right edge auto-scrolls, so a day off screen is
 *     reachable at all (the window is routinely wider than the viewport).
 *
 * Each of those exists only as an event listener, so this drives the built app.
 * Exits non-zero on the first failed assertion, so `npm run verify` fails loudly.
 */
import { chromium } from 'playwright'
import path from 'node:path'

const failures = []
const errs = []
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`)
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push(label) }
}

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1300, height: 850 } })
p.on('pageerror', (e) => errs.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`file://${path.resolve('dist-single/weekspan.html')}?today=2026-08-26&fixture=demo&theme=paper`)
await p.waitForTimeout(1300)
await p.evaluate(() => { document.documentElement.style.zoom = '' })

const rowIds = () => p.evaluate(() =>
  [...document.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId))
const markAt = (id, date) => p.evaluate(([i, d]) => {
  const c = document.querySelector(`[data-row-id="${i}"] [data-cell-date="${d}"]`)
  return c?.querySelector('.ws-chip')?.textContent?.trim() || null
}, [id, date])
const box = async (sel) => (await p.$(sel))?.boundingBox() ?? null
const center = (r) => [r.x + r.width / 2, r.y + r.height / 2]

/** Drag from a point to a point, in steps — one jump emits no intermediate moves. */
async function drag([sx, sy], [tx, ty], steps = 12) {
  await p.mouse.move(sx, sy)
  await p.mouse.down()
  for (let s = 1; s <= steps; s++) {
    await p.mouse.move(sx + (tx - sx) * (s / steps), sy + (ty - sy) * (s / steps))
    await p.waitForTimeout(16)
  }
}

const dates = await p.evaluate(() =>
  [...new Set([...document.querySelectorAll('[data-cell-date]')].map((e) => e.dataset.cellDate))].sort())

// Any explicitly-marked chip will do; a generated occurrence deliberately has
// no `--draggable` class, so this also asserts that at least one real one exists.
const found = await p.evaluate(() => {
  for (const row of document.querySelectorAll('[data-row-id]')) {
    for (const cell of row.querySelectorAll('[data-cell-date]')) {
      const chip = cell.querySelector('.ws-chip--draggable')
      if (chip) return { id: row.dataset.rowId, date: cell.dataset.cellDate, kind: chip.textContent.trim() }
    }
  }
  return null
})
check('an explicit mark advertises itself as draggable', found !== null)
if (!found) { await b.close(); process.exit(1) }

const nextDate = dates[dates.indexOf(found.date) + 1]

console.log('Sideways — the columns are the days')
await drag(
  center(await box(`[data-row-id="${found.id}"] [data-cell-date="${found.date}"] .ws-chip`)),
  [center(await box(`[data-row-id="${found.id}"] [data-cell-date="${nextDate}"]`))[0],
   center(await box(`[data-row-id="${found.id}"] [data-cell-date="${found.date}"] .ws-chip`))[1]],
)
check('the preview draws the chip on the hovered day, before release',
  await p.evaluate(([id, d]) =>
    !!document.querySelector(`[data-row-id="${id}"] [data-cell-date="${d}"] .ws-chip--lifted`),
  [found.id, nextDate]))
await p.mouse.up(); await p.waitForTimeout(400)
check('the mark landed on the day it was dropped on',
  (await markAt(found.id, nextDate)) === found.kind, `got ${await markAt(found.id, nextDate)}`)
check('and left its original day empty',
  (await markAt(found.id, found.date)) === null, `got ${await markAt(found.id, found.date)}`)

console.log('A chip that was only clicked still cycles')
const before = await markAt(found.id, nextDate)
await p.mouse.click(...center(await box(`[data-row-id="${found.id}"] [data-cell-date="${nextDate}"] .ws-chip`)),
  { button: 'right' })
await p.waitForTimeout(350)
check('right click on a chip cycles it, as it always has',
  (await markAt(found.id, nextDate)) !== before, `still ${before}`)

console.log('Diagonal — day and priority in one gesture')
const origin = (await rowIds())[0]
const from = dates[2], to = dates[4]
await p.mouse.click(...center(await box(`[data-row-id="${origin}"] [data-cell-date="${from}"]`)),
  { button: 'right' })
await p.waitForTimeout(350)
check('seeded a DUE on the first row', (await markAt(origin, from)) === 'DUE')

const orderBefore = await rowIds()
const targetRow = await box(`[data-row-id="${orderBefore[3]}"] .ws-title`)
const destCol = await box(`[data-row-id="${origin}"] [data-cell-date="${to}"]`)
await drag(
  center(await box(`[data-row-id="${origin}"] [data-cell-date="${from}"] .ws-chip`)),
  [destCol.x + destCol.width / 2, targetRow.y + targetRow.height - 2],
)
await p.mouse.up(); await p.waitForTimeout(450)

const orderAfter = await rowIds()
check('the row moved down the priority order',
  orderAfter.indexOf(origin) > orderBefore.indexOf(origin),
  `${orderBefore.indexOf(origin)} -> ${orderAfter.indexOf(origin)}`)
check('and the mark moved to the dropped-on day',
  (await markAt(origin, to)) === 'DUE', `got ${await markAt(origin, to)}`)
check('leaving the original day empty',
  (await markAt(origin, from)) === null, `got ${await markAt(origin, from)}`)

console.log('One gesture is one write')
await p.keyboard.press('Control+z'); await p.waitForTimeout(400)
check('a single undo restores the day', (await markAt(origin, from)) === 'DUE',
  `got ${await markAt(origin, from)}`)
check('and that same undo restores the order',
  (await rowIds()).indexOf(origin) === orderBefore.indexOf(origin))

console.log('Auto-scroll — a day off the right edge is still reachable')
{
  const chipCell = await p.evaluate(() => {
    for (const row of document.querySelectorAll('[data-row-id]'))
      for (const cell of row.querySelectorAll('[data-cell-date]'))
        if (cell.querySelector('.ws-chip--draggable'))
          return { id: row.dataset.rowId, date: cell.dataset.cellDate }
    return null
  })
  check('there is still a draggable mark to work with', chipCell !== null)
  if (chipCell) {
    const scroller = await box('.ws-scroll')
    const chip = await box(`[data-row-id="${chipCell.id}"] [data-cell-date="${chipCell.date}"] .ws-chip`)
    const [cx, cy] = center(chip)
    const scrollBefore = await p.evaluate(() => document.querySelector('.ws-scroll').scrollLeft)
    await p.mouse.move(cx, cy)
    await p.mouse.down()
    // Park in the right-hand zone and hold STILL: auto-scroll runs off rAF, so
    // a stationary pointer must keep it going.
    await p.mouse.move(scroller.x + scroller.width - 6, cy)
    await p.waitForTimeout(1200)
    const scrollAfter = await p.evaluate(() => document.querySelector('.ws-scroll').scrollLeft)
    check('holding at the edge keeps scrolling with the pointer still',
      scrollAfter > scrollBefore, `${scrollBefore} -> ${scrollAfter}`)
    const hovered = await p.evaluate(() => {
      const el = document.querySelector('.ws-chip--lifted')
      return el ? el.closest('[data-cell-date]').dataset.cellDate : null
    })
    check('the preview followed past the original right edge',
      hovered !== null && hovered > chipCell.date, `previewing ${hovered}, from ${chipCell.date}`)
    await p.mouse.up(); await p.waitForTimeout(400)
    check('and the mark landed on the day it was scrolled to',
      (await markAt(chipCell.id, hovered)) !== null, `nothing at ${hovered}`)
  }
}

check('no console errors', errs.length === 0, errs.join(' | '))
await b.close()
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\nmark-drag probe: all checks passed')
process.exit(failures.length ? 1 : 0)
