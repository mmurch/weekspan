/**
 * Inline link probe.
 *
 * A link lives in the item's own text, at the spot it was pasted, and renders
 * there as an icon (`parseTitleLinks` + `InlineLinks`). The parser and the
 * clipboard helpers are unit-tested; what only exists as wiring is:
 *
 *   - a real Cmd+V putting the URL into the text at the right place, in every
 *     surface that takes text: quick capture, the title editor, the draft row,
 *     and a selected row with no editor open;
 *   - the icon rendering IN POSITION rather than at the end of the line;
 *   - an unnamed link showing NO stand-in label — just the icon;
 *   - a name surviving when the clipboard carried one.
 *
 * Driven with a real Cmd+V against the browser's own clipboard. An earlier
 * version of this probe dispatched synthetic paste events and passed while the
 * gesture people actually use did nothing.
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
p.setDefaultTimeout(5000)
p.on('pageerror', (e) => errs.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`file://${path.resolve('dist-single/weekspan.html')}?today=2026-08-26&fixture=demo&theme=paper`)
await p.waitForTimeout(1300)
await p.evaluate(() => { document.documentElement.style.zoom = '' })

const DOC = 'https://docs.google.com/document/d/aaa111/edit'
const SHEET = 'https://docs.google.com/spreadsheets/d/bbb222/edit'

/** Put text (and optionally an html flavour) on the browser's real clipboard. */
async function copyReal(plain, html) {
  // Sets BOTH flavours by overriding the copy event: a real "copy link" puts
  // the URL in text/plain and the anchor in text/html. Copying rendered anchor
  // text instead puts the VISIBLE TEXT in text/plain, which is a different
  // gesture entirely (and correctly pastes as text).
  await p.evaluate(([t, h]) => {
    const ta = document.createElement('textarea')
    ta.id = '__cb'; ta.value = t
    document.body.appendChild(ta); ta.focus(); ta.select()
    const onCopy = (e) => {
      e.clipboardData.setData('text/plain', t)
      if (h) e.clipboardData.setData('text/html', h)
      e.preventDefault()
      document.removeEventListener('copy', onCopy, true)
    }
    document.addEventListener('copy', onCopy, true)
  }, [plain, html])
  await p.keyboard.press('Meta+C')
  await p.evaluate(() => { document.getElementById('__cb').remove(); document.activeElement?.blur?.() })
}

/** What the row's title renders as: text pieces and inline link icons, in order. */
const renderedTitle = (id) => p.evaluate((i) => {
  const el = document.querySelector(`[data-row-id="${i}"] .ws-title-text`)
  if (!el) return null
  return [...el.childNodes].map((n) => {
    if (n.nodeType === Node.TEXT_NODE) return { t: 'text', v: n.textContent }
    if (n.classList?.contains('ws-ilink')) {
      return {
        t: 'link',
        kind: (n.className.match(/ws-ilink--(\w+)/) || [])[1],
        href: n.getAttribute('href'),
        name: n.querySelector('.ws-ilink-name')?.textContent ?? null,
      }
    }
    return { t: 'other', v: n.textContent }
  })
}, id)
const rowIdByText = (fragment) => p.evaluate((f) => {
  for (const r of document.querySelectorAll('[data-row-id]'))
    if ((r.querySelector('.ws-title-text')?.textContent ?? '').includes(f)) return r.dataset.rowId
  return null
}, fragment)
const rows = await p.evaluate(() => [...document.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId))

console.log('Quick capture: the icon appears where the link was typed')
await copyReal(DOC)
await p.keyboard.press('Meta+K'); await p.waitForTimeout(250)
await p.keyboard.type('review ')
await p.keyboard.press('Meta+V'); await p.waitForTimeout(150)
await p.keyboard.type(' before the meeting')
await p.keyboard.press('Enter'); await p.waitForTimeout(450)
const capId = await rowIdByText('review')
const cap = capId ? await renderedTitle(capId) : []
check('the todo was created', capId !== null)
check('text, then the icon, then more text — in position', cap.length === 3 &&
  cap[0].t === 'text' && cap[1].t === 'link' && cap[2].t === 'text', JSON.stringify(cap))
check('the icon knows it is a Doc', cap[1]?.kind === 'gdoc', JSON.stringify(cap[1]))
check('and shows NO stand-in label', cap[1]?.name === null, JSON.stringify(cap[1]))
check('the words around it survive', (cap[0]?.v ?? '').includes('review') && (cap[2]?.v ?? '').includes('before the meeting'),
  JSON.stringify([cap[0], cap[2]]))

console.log('A clipboard that carries a name keeps it')
await copyReal(SHEET, `<a href="${SHEET}">Kitchen budget</a>`)
await p.keyboard.press('Meta+K'); await p.waitForTimeout(250)
await p.keyboard.type('check ')
await p.keyboard.press('Meta+V'); await p.waitForTimeout(200)
const capText = await p.evaluate(() => document.querySelector('.ws-capture-input')?.value ?? '')
check('the box holds [name](url) markup', capText.includes('[Kitchen budget](') , JSON.stringify(capText))
await p.keyboard.press('Enter'); await p.waitForTimeout(450)
const namedId = await rowIdByText('check')
const named = namedId ? await renderedTitle(namedId) : []
const namedLink = named.find((s) => s.t === 'link')
check('the name renders beside the icon', namedLink?.name === 'Kitchen budget', JSON.stringify(named))
check('and it is a Sheet', namedLink?.kind === 'gsheet', JSON.stringify(namedLink))

console.log('Paste into the title editor lands at the caret')
await copyReal(DOC)
await p.click(`[data-row-id="${rows[0]}"] .ws-title-text`); await p.waitForTimeout(200)
await p.keyboard.press('End')
await p.keyboard.type(' ')
await p.keyboard.press('Meta+V'); await p.waitForTimeout(150)
await p.keyboard.press('Enter'); await p.waitForTimeout(400)
const edited = await renderedTitle(rows[0])
check('the edited title now ends with an icon', edited?.at(-1)?.t === 'link', JSON.stringify(edited))

console.log('Paste with a row selected, no editor open')
await copyReal(SHEET)
await p.click(`[data-row-id="${rows[1]}"] [data-cell-date="2026-08-26"]`); await p.waitForTimeout(150)
await p.keyboard.press('Meta+V'); await p.waitForTimeout(400)
const appended = await renderedTitle(rows[1])
check('it is appended to that row as an icon', appended?.some((s) => s.t === 'link'), JSON.stringify(appended))

console.log('Ordinary text still pastes as text')
await copyReal('see the doc for details')
await p.click(`[data-row-id="${rows[2]}"] [data-cell-date="2026-08-26"]`); await p.waitForTimeout(150)
const before = await renderedTitle(rows[2])
await p.keyboard.press('Meta+V'); await p.waitForTimeout(350)
check('nothing changed', JSON.stringify(await renderedTitle(rows[2])) === JSON.stringify(before))

console.log('Undo covers it like any other write')
await p.keyboard.press('Control+z'); await p.waitForTimeout(400)
check('undo removes the appended link', !(await renderedTitle(rows[1]))?.some((s) => s.t === 'link'),
  JSON.stringify(await renderedTitle(rows[1])))

check('no console errors', errs.length === 0, errs.join(' | '))
await b.close()
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\ninline-links probe: all checks passed')
process.exit(failures.length ? 1 : 0)
