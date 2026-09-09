/**
 * Link-chip probe.
 *
 * `links.test.ts` (core) and `clipboard.test.ts` cover the URL classifier, the
 * clipboard parser and the three mutations. What only exists as wiring, and so
 * only fails in a real browser, is:
 *
 *   - a paste onto a SELECTED ROW becoming a chip, and a paste of ordinary
 *     text still pasting as text;
 *   - a paste INSIDE the title editor being lifted out into a chip rather than
 *     typed into the title — the gesture people actually reach for;
 *   - the title coming from the clipboard's html flavour when there is one,
 *     and falling back to the kind label when there is not;
 *   - rename and remove.
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

const rows = await p.evaluate(() => [...document.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId))
const chips = (id) => p.evaluate((i) =>
  [...document.querySelectorAll(`[data-row-id="${i}"] .ws-link`)].map((e) => ({
    kind: (e.className.match(/ws-link--(\w+)/) || [])[1],
    title: e.querySelector('.ws-link-title')?.textContent ?? '',
    href: e.querySelector('.ws-link-icon')?.getAttribute('href') ?? '',
  })), id)
const titleOf = (id) => p.evaluate((i) =>
  document.querySelector(`[data-row-id="${i}"] .ws-title-text`)?.textContent?.trim() ?? '', id)
/** Select a row by clicking one of its day cells — clicking the title would open the editor. */
const selectRow = async (id) => {
  await p.evaluate((i) => {
    document.querySelector(`[data-row-id="${i}"] [data-cell-date]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  }, id)
  await p.waitForTimeout(120)
}
const paste = async (target, plain, html) => {
  await p.evaluate(([sel, plain, html]) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', plain)
    if (html) dt.setData('text/html', html)
    const el = sel ? document.querySelector(sel) : document.body
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, [target, plain, html])
  await p.waitForTimeout(320)
}

const DOC = 'https://docs.google.com/document/d/aaa111/edit'
const SHEET = 'https://docs.google.com/spreadsheets/d/bbb222/edit'

console.log('Paste onto a selected row')
await selectRow(rows[0])
await paste(null, DOC, `<a href="${DOC}">Weymouth tile spec v3</a>`)
let c = await chips(rows[0])
check('a chip appeared', c.length === 1, JSON.stringify(c))
check('with the kind read from the URL', c[0]?.kind === 'gdoc', c[0]?.kind)
check('and the title taken from the clipboard html flavour',
  c[0]?.title === 'Weymouth tile spec v3', c[0]?.title)
check('the icon links to the doc', c[0]?.href === DOC, c[0]?.href)

console.log('No html flavour — the kind label stands in, never the raw URL')
await selectRow(rows[1])
await paste(null, SHEET, null)
c = await chips(rows[1])
check('chip is a sheet', c[0]?.kind === 'gsheet', JSON.stringify(c))
check('titled with the placeholder', c[0]?.title === 'Google Sheet', c[0]?.title)

console.log('Ordinary text still pastes as text')
const before = await chips(rows[2])
await selectRow(rows[2])
await paste(null, 'see the doc for details', null)
check('no chip from prose', (await chips(rows[2])).length === before.length)

console.log('Paste inside the title editor lifts the URL out')
const originalTitle = await titleOf(rows[3])
await p.click(`[data-row-id="${rows[3]}"] .ws-title-text`)
await p.waitForTimeout(200)
await paste('.ws-inline-edit', DOC, `<a href="${DOC}">Shared spec</a>`)
await p.keyboard.press('Enter')
await p.waitForTimeout(350)
check('the title is unchanged — no URL typed into it',
  (await titleOf(rows[3])) === originalTitle, `${originalTitle} -> ${await titleOf(rows[3])}`)
c = await chips(rows[3])
check('and the link became a chip instead', c[0]?.title === 'Shared spec', JSON.stringify(c))

console.log('Rename and remove')
await p.click(`[data-row-id="${rows[1]}"] .ws-link-title`)
await p.waitForTimeout(200)
await p.fill('.ws-link-edit', 'Kitchen budget')
await p.keyboard.press('Enter')
await p.waitForTimeout(350)
check('renaming the placeholder sticks',
  (await chips(rows[1]))[0]?.title === 'Kitchen budget', JSON.stringify(await chips(rows[1])))

await p.click(`[data-row-id="${rows[1]}"] .ws-link-remove`)
await p.waitForTimeout(350)
check('× removes the chip', (await chips(rows[1])).length === 0, JSON.stringify(await chips(rows[1])))

console.log('Undo covers it like any other write')
await p.keyboard.press('Control+z'); await p.waitForTimeout(400)
check('undo brings the removed chip back', (await chips(rows[1])).length === 1)

check('no console errors', errs.length === 0, errs.join(' | '))
await b.close()
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\nlinks probe: all checks passed')
process.exit(failures.length ? 1 : 0)
