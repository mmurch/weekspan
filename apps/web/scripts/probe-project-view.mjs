/**
 * Project-view interaction probe.
 *
 * Unit tests cover every pure function these interactions call, and they all
 * passed while Project view was in fact inert: the drag preview ran over
 * Priority view's rows, the commit read Project view's, and no seam was
 * rendered at all. Nothing was wrong with any single function — the WIRING
 * between them was missing, which is exactly what a unit test cannot see.
 *
 * So this drives the built single-file app in a real browser and asserts on
 * what the DOM actually does: a drag moves a row into another group, a seam
 * opens a draft, and the draft commits into the group it was opened in.
 *
 * Exits non-zero on the first failed assertion so `npm run verify` fails loudly.
 */
import { chromium } from 'playwright'
import path from 'node:path'

const file = path.resolve('dist-single/weekspan.html')
const failures = []
const errors = []

function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } })
p.on('pageerror', (e) => errors.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await p.goto(`file://${file}?today=2026-08-26&fixture=demo&theme=paper`)
await p.waitForTimeout(1200)

// CSS `zoom` on <html> puts layout and visual coordinates in different spaces
// (see App.tsx, "Zoom is applied to the document root"). Harmless for real
// users — the cell menu lands under the cursor at every zoom level — but it
// makes synthetic pointer coordinates disagree with getBoundingClientRect, so
// the probe drops it before driving anything.
await p.evaluate(() => { document.documentElement.style.zoom = '' })
await p.waitForTimeout(150)

/** The rendered list as `#group` / itemId tokens, in document order. */
const shape = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('.ws-divider, [data-row-id]')].map((e) =>
      e.dataset.dividerKey ? `#${e.dataset.dividerKey}` : e.dataset.rowId,
    ),
  )

const groupOf = (id) =>
  p.evaluate((wanted) => {
    let g = null
    for (const e of document.querySelectorAll('.ws-divider, [data-row-id]')) {
      if (e.dataset.dividerKey) { g = e.dataset.dividerKey; continue }
      if (e.dataset.rowId === wanted) return g
    }
    return null
  }, id)

async function dragTo(gripSel, targetY) {
  const g = await (await p.$(gripSel)).boundingBox()
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await p.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(g.x + g.width / 2, g.y + (targetY - g.y) * (i / 10))
    await p.waitForTimeout(20)
  }
  await p.mouse.up()
  await p.waitForTimeout(400)
}

console.log('Priority view')
{
  const before = await p.evaluate(() => [...document.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId))
  const third = await (await p.$(`[data-row-id="${before[2]}"] .ws-title`)).boundingBox()
  await dragTo(`[data-row-id="${before[0]}"] .ws-grip`, third.y + third.height + 5)
  const after = await p.evaluate(() => [...document.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId))
  check('drag reorders rows', JSON.stringify(before) !== JSON.stringify(after), JSON.stringify(after))

  // The top-of-list seam has no row above it, so a draft keyed by "the id of the
  // row above" could never render there.
  await p.evaluate(() => document.querySelectorAll('.ws-seam')[0].click())
  await p.waitForTimeout(250)
  check('top-of-list seam opens a draft', (await p.evaluate(() => document.querySelectorAll('.ws-row--draft').length)) === 1)
  await p.keyboard.type('probe top item')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(400)
  check(
    'top-of-list draft commits first',
    await p.evaluate(() => (document.querySelector('[data-row-id] .ws-title')?.textContent ?? '').includes('probe top item')),
  )
}

console.log('Project view')
await p.click('button.ws-seg:has-text("Project")')
await p.waitForTimeout(400)
{
  const before = await shape()
  check('renders group dividers', before.some((s) => s.startsWith('#')), JSON.stringify(before))
  check('renders insertion seams', (await p.evaluate(() => document.querySelectorAll('.ws-seam').length)) > 0)

  // --- Drag an item into a different group. ---
  const item = before.find((s) => !s.startsWith('#'))
  const targetGroup = before.filter((s) => s.startsWith('#'))[1]?.slice(1)
  const t = await (await p.$(`[data-divider-key="${targetGroup}"]`)).boundingBox()

  const grip = await (await p.$(`[data-row-id="${item}"] .ws-grip`)).boundingBox()
  await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await p.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(grip.x + grip.width / 2, grip.y + (t.y + t.height + 20 - grip.y) * (i / 10))
    await p.waitForTimeout(25)
  }
  const mid = await shape()
  check('drag shows a live preview', JSON.stringify(mid) !== JSON.stringify(before), JSON.stringify(mid))
  await p.mouse.up()
  await p.waitForTimeout(400)

  check(`drag files "${item}" into "${targetGroup}"`, (await groupOf(item)) === targetGroup, `landed in ${await groupOf(item)}`)

  // --- Reorder within a group. ---
  const s0 = await shape()
  let gi = -1
  for (let i = 0; i < s0.length; i++) {
    if (s0[i].startsWith('#') && s0[i + 1] && !s0[i + 1].startsWith('#') && s0[i + 2] && !s0[i + 2].startsWith('#')) { gi = i; break }
  }
  if (gi === -1) check('found a group with two items to reorder', false)
  else {
    const [group, a, c] = [s0[gi], s0[gi + 1], s0[gi + 2]]
    const cb = await (await p.$(`[data-row-id="${c}"] .ws-title`)).boundingBox()
    await dragTo(`[data-row-id="${a}"] .ws-grip`, cb.y + cb.height - 2)
    const s1 = await shape()
    const at = s1.indexOf(group)
    check('reorders within a group', s1[at + 1] === c && s1[at + 2] === a, JSON.stringify(s1.slice(at, at + 3)))
    check('reorder keeps both items in the group', (await groupOf(a)) === group.slice(1))
  }

  // --- Inline create inside a group. ---
  const seamGroup = await p.evaluate(() => {
    const seam = document.querySelectorAll('.ws-seam')[1]
    let g = null
    for (const e of document.querySelectorAll('.ws-divider, .ws-seam')) {
      if (e === seam) return g
      if (e.dataset.dividerKey) g = e.dataset.dividerKey
    }
    return g
  })
  await p.evaluate(() => document.querySelectorAll('.ws-seam')[1].click())
  await p.waitForTimeout(250)
  check('seam opens a draft row', (await p.evaluate(() => document.querySelectorAll('.ws-row--draft').length)) === 1)
  await p.keyboard.type('probe project item')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(400)
  const landed = await p.evaluate(() => {
    let g = null
    for (const e of document.querySelectorAll('.ws-divider, [data-row-id]')) {
      if (e.dataset.dividerKey) { g = e.dataset.dividerKey; continue }
      if ((e.querySelector('.ws-title')?.textContent ?? '').includes('probe project item')) return g
    }
    return null
  })
  check(`new item joins the group it was created in (${seamGroup})`, landed === seamGroup, `landed in ${landed}`)
}

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await b.close()

if (failures.length > 0) {
  console.error(`\nproject-view probe: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nproject-view probe: all checks passed')
