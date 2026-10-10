/**
 * Undo/redo probe.
 *
 * The history mechanics are unit-tested in `src/store/history.test.ts`. What
 * cannot be covered there is the WIRING inside `useWeekspan` — when the stack
 * is recorded and, more importantly, when it is discarded. The invalidation
 * rules are the correctness-critical half of the feature, and each one only
 * exists as a call in a hook, so this drives the built app instead.
 *
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

const rowIds = () => p.evaluate(() => [...document.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId))
const markAt = (id, date) => p.evaluate(([i, d]) => {
  const c = document.querySelector(`[data-row-id="${i}"] [data-cell-date="${d}"]`)
  return c?.querySelector('.ws-chip')?.textContent?.trim() || null
}, [id, date])
const undoHintDim = () => p.evaluate(() =>
  [...document.querySelectorAll('.ws-foot span')].some((s) => s.textContent.includes('undo') && s.className.includes('dim')))
const undoKey = async (shift = false) => {
  await p.keyboard.press(shift ? 'Control+Shift+z' : 'Control+z')
  await p.waitForTimeout(320)
}

const ID = 'item-paint', DATE = '2026-08-26'
const cell = await (await p.$(`[data-row-id="${ID}"] [data-cell-date="${DATE}"]`)).boundingBox()
const cx = cell.x + cell.width / 2, cy = cell.y + cell.height / 2

console.log('Marks')
check('undo hint starts dimmed — nothing to undo yet', await undoHintDim())
await p.mouse.click(cx, cy, { button: 'right' }); await p.waitForTimeout(300)
check('a mark lands', (await markAt(ID, DATE)) === 'DUE')
check('undo hint lights up', !(await undoHintDim()))
await undoKey()
check('undo clears the mark', (await markAt(ID, DATE)) === null, `got ${await markAt(ID, DATE)}`)
await undoKey(true)
check('redo puts it back', (await markAt(ID, DATE)) === 'DUE', `got ${await markAt(ID, DATE)}`)

console.log('Several steps')
await p.mouse.click(cx, cy, { button: 'right' }); await p.waitForTimeout(250) // -> done
await p.mouse.click(cx, cy, { button: 'right' }); await p.waitForTimeout(250) // -> blank
check('walked to blank', (await markAt(ID, DATE)) === null)
await undoKey(); await undoKey()
check('two undos land back on DUE', (await markAt(ID, DATE)) === 'DUE', `got ${await markAt(ID, DATE)}`)

console.log('Reordering')
const before = await rowIds()
const grip = await (await p.$(`[data-row-id="${before[0]}"] .ws-grip`)).boundingBox()
const target = await (await p.$(`[data-row-id="${before[2]}"] .ws-title`)).boundingBox()
await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
await p.mouse.down()
for (let i = 1; i <= 8; i++) {
  await p.mouse.move(grip.x + grip.width / 2, grip.y + (target.y + target.height - grip.y) * (i / 8))
  await p.waitForTimeout(18)
}
await p.mouse.up(); await p.waitForTimeout(400)
const reordered = await rowIds()
check('drag reordered the list', JSON.stringify(reordered) !== JSON.stringify(before))
await undoKey()
check('undo restores the original order', JSON.stringify(await rowIds()) === JSON.stringify(before),
  JSON.stringify(await rowIds()))

console.log('A new change branches off')
await undoKey(true) // redo the reorder, so there is forward history
await p.mouse.click(cx, cy, { button: 'right' }); await p.waitForTimeout(300) // new change
const afterBranch = await markAt(ID, DATE)
await undoKey(true) // redo should now do nothing
check('redo is dropped once a new change branches', (await markAt(ID, DATE)) === afterBranch,
  `mark moved to ${await markAt(ID, DATE)}`)

console.log('Another writer merging in wipes the history')
// The correctness risk: snapshots taken before someone else's edit predate it,
// so undoing to one would silently discard their work.
const externalOk = await p.evaluate(async () => {
  const store = globalThis.__weekspanFixtureStore
  if (!store) return 'no store'
  const current = await store.read()
  const parsed = JSON.parse(current)
  parsed.items.push({ id: 'from-elsewhere', title: 'written by another writer', rank: 'zz', marks: {} })
  store.externalWrite(JSON.stringify(parsed, null, 2))
  return 'ok'
})
check('probe could act as a second writer', externalOk === 'ok', String(externalOk))
await p.waitForTimeout(2800) // let the 2s poll pick it up and merge
const merged = await p.evaluate(() =>
  [...document.querySelectorAll('.ws-title-text')].some((e) => e.textContent.includes('another writer')))
check('the external edit merged in', merged)
check('undo history was discarded', await undoHintDim())
const beforeUndo = await rowIds()
await undoKey()
check('Ctrl+Z after a merge does nothing, rather than dropping their edit',
  JSON.stringify(await rowIds()) === JSON.stringify(beforeUndo))

console.log('Close-out is a barrier, not a step')
// It writes archive/<week>.json, FileStore has no delete, and writeArchive
// refuses to overwrite — so a redo past a close would throw outright.
await p.mouse.click(cx, cy, { button: 'right' }); await p.waitForTimeout(300)
check('there is something to undo before closing', !(await undoHintDim()))
const closeBtn = await p.$('.ws-week-close:not([disabled])')
if (!closeBtn) {
  check('a closeable week was available to test the barrier', false, 'no enabled close button')
} else {
  await closeBtn.click(); await p.waitForTimeout(400)
  const buttons = await p.$$eval('.ws-closeout-panel button', (bs) => bs.map((x) => x.textContent))
  const idx = buttons.findIndex((t) => /close|confirm/i.test(t ?? ''))
  if (idx === -1) {
    check('close-out panel offered a confirm', false, JSON.stringify(buttons))
  } else {
    await (await p.$$('.ws-closeout-panel button'))[idx].click()
    await p.waitForTimeout(600)
    check('undo history cleared by close-out', await undoHintDim())
    check('the panel said so', await p.evaluate(() =>
      (document.querySelector('[class*=notice]')?.textContent ?? '').includes('cannot be undone')))
  }
}

check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '))
await b.close()

if (failures.length > 0) {
  console.error(`\nundo probe: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nundo probe: all checks passed')
