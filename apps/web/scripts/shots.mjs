/**
 * Screenshot harness.
 *
 * The point is not regression diffing — it is that a grid can pass every unit
 * test while looking nothing like the design. These shots get compared by eye
 * against design_handoff_todo_ledger/screenshots/.
 *
 * Serves a production build rather than the dev server so what is captured is
 * what actually ships.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, 'shots')

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

function serve(port) {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    const rel = url === '/' ? 'index.html' : url.slice(1)
    const file = path.join(DIST, rel)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      // SPA fallback
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(await readFile(path.join(DIST, 'index.html')))
    }
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

/**
 * Each shot pins `today` and the fixture through the URL, so captures are
 * deterministic — a screenshot that drifts because the real date moved would be
 * useless for comparison.
 */
const SHOTS = [
  { name: '01-priority-paper', q: 'theme=paper&fixture=demo' },
  { name: '02-priority-solarized', q: 'theme=solarized&fixture=demo' },
  { name: '03-priority-warm', q: 'theme=warm&fixture=demo' },
  { name: '04-wrapping-torture', q: 'theme=paper&fixture=wrapping' },
  { name: '05-empty', q: 'theme=paper&fixture=empty' },
]

const PORT = 4319
const TODAY = '2026-08-26'

const server = await serve(PORT)
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

for (const shot of SHOTS) {
  await page.goto(`http://localhost:${PORT}/?today=${TODAY}&${shot.q}`, { waitUntil: 'networkidle' })
  // Web fonts change metrics; capturing before they land would misrepresent layout.
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) })
  console.log(`shot: ${shot.name}`)
}

/**
 * Column alignment check, measured in the real browser.
 *
 * This is the actual risk: titles wrap to multiple lines and every 38px day
 * column must stay aligned across the whole table. A DOM-structure assertion
 * cannot see a misalignment; measured geometry can.
 */
await page.goto(`http://localhost:${PORT}/?today=${TODAY}&theme=paper&fixture=wrapping`, {
  waitUntil: 'networkidle',
})
await page.evaluate(() => document.fonts.ready)

const alignment = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-cell-date]')]
  const byDate = new Map()
  for (const el of cells) {
    const date = el.getAttribute('data-cell-date')
    const left = Math.round(el.getBoundingClientRect().left)
    if (!byDate.has(date)) byDate.set(date, new Set())
    byDate.get(date).add(left)
  }
  const misaligned = [...byDate.entries()]
    .filter(([, lefts]) => lefts.size > 1)
    .map(([date, lefts]) => ({ date, lefts: [...lefts] }))
  return { dates: byDate.size, cells: cells.length, misaligned }
})

console.log(`\ncolumn alignment: ${alignment.dates} dates, ${alignment.cells} cells`)
if (alignment.misaligned.length > 0) {
  console.error('MISALIGNED COLUMNS:', JSON.stringify(alignment.misaligned, null, 2))
} else {
  console.log('all day columns aligned across wrapping rows')
}

await browser.close()
server.close()
if (alignment.misaligned.length > 0) process.exit(1)
