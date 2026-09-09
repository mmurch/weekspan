/**
 * Quick-capture probe — the project is TICKED, never guessed.
 *
 * `capture.test.ts` proves the parser no longer infers a project. What it
 * cannot prove is that the overlay actually offers the opt-in, that leaving it
 * alone really files the item nowhere, and that a word which used to be eaten
 * by the old name/prefix matcher now survives into the title of a REAL item.
 * That is the whole bug, and it only exists end to end.
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

const openCapture = async () => { await p.keyboard.press('Control+k'); await p.waitForTimeout(250) }
const marks = () => p.evaluate(() =>
  [...document.querySelectorAll('.ws-capture-mark')].map((m) => `${m.className}:${m.textContent}`))
const resolved = () => p.evaluate(() =>
  document.querySelector('.ws-capture-resolved')?.textContent?.trim() ?? '')
const projectBoxes = () => p.evaluate(() =>
  [...document.querySelectorAll('.ws-capture-project')].map((l) => ({
    name: l.textContent.trim(),
    checked: l.querySelector('input').checked,
  })))
/** The project bar colour token on a row, which is how the grid shows filing. */
const projectOf = (title) => p.evaluate((t) => {
  for (const row of document.querySelectorAll('[data-row-id]')) {
    if (row.querySelector('.ws-title-text')?.textContent?.trim() === t) {
      return row.querySelector('.ws-bar')?.getAttribute('style') ?? null
    }
  }
  return 'NO SUCH ROW'
}, title)

console.log('A project name in the text is just text')
await openCapture()
await p.keyboard.type('order tile samples thu weymouth')
await p.waitForTimeout(200)
const m = await marks()
check('the day-word still highlights', m.some((x) => x.includes('--due') && x.endsWith(':thu')), m.join(' | '))
check('nothing else highlights at all', m.length === 1, m.join(' | '))
check('the resolved line says no project by default', (await resolved()).includes('no project'),
  await resolved())

const boxes = await projectBoxes()
check('every project is offered as an opt-in checkbox', boxes.length > 0, JSON.stringify(boxes))
check('none of them starts ticked', boxes.every((x) => !x.checked), JSON.stringify(boxes))

await p.keyboard.press('Enter'); await p.waitForTimeout(450)
check('the item keeps the project word in its title',
  (await projectOf('order tile samples weymouth')) !== 'NO SUCH ROW')
check('and is filed under no project', (await projectOf('order tile samples weymouth')) === null,
  String(await projectOf('order tile samples weymouth')))

console.log('Ticking one files the item; ticking another moves the tick')
await openCapture()
await p.keyboard.type('fit new skirting')
await p.click('.ws-capture-project:nth-of-type(1) input'); await p.waitForTimeout(150)
let after = await projectBoxes()
check('the first box is ticked', after[0].checked, JSON.stringify(after))
check('the resolved line names it', (await resolved()).includes(after[0].name), await resolved())

if (after.length > 1) {
  await p.click('.ws-capture-project:nth-of-type(2) input'); await p.waitForTimeout(150)
  after = await projectBoxes()
  check('ticking a second one unticks the first — an item has exactly one project',
    !after[0].checked && after[1].checked, JSON.stringify(after))
  await p.click('.ws-capture-project:nth-of-type(2) input'); await p.waitForTimeout(150)
  check('and unticking returns to no project', (await resolved()).includes('no project'), await resolved())
  await p.click('.ws-capture-project:nth-of-type(1) input'); await p.waitForTimeout(150)
}

const chosen = (await projectBoxes())[0].name
await p.keyboard.press('Enter'); await p.waitForTimeout(450)
check(`the item was filed under "${chosen}"`, (await projectOf('fit new skirting')) !== null,
  String(await projectOf('fit new skirting')))

check('no console errors', errs.length === 0, errs.join(' | '))
await b.close()
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\ncapture probe: all checks passed')
process.exit(failures.length ? 1 : 0)
