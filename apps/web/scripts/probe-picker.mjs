/**
 * Screenshots the first-run "choose a folder" screen (`FilePicker.tsx`) in
 * all three themes. No `?fixture=` param, so no store gets bound and the
 * picker is what actually renders — this is the FIRST screen anyone sees,
 * and until FilePicker.css existed it rendered as raw unstyled HTML.
 *
 * Serves a production build (not the dev server) so what is captured is
 * what actually ships, same convention as scripts/shots.mjs.
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
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(await readFile(path.join(DIST, 'index.html')))
    }
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

const THEMES = ['paper', 'solarized', 'warm']
const PORT = 4327

const server = await serve(PORT)
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

for (const theme of THEMES) {
  // No `fixture` param: App.tsx's `store` stays null, so FilePicker renders.
  await page.goto(`http://localhost:${PORT}/?theme=${theme}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // Let the "loading recent folders" IndexedDB read resolve so the shot
  // shows the settled state, not the transient loading hint.
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `picker-${theme}.png`) })
  console.log(`shot: picker-${theme}`)
}

console.log('')
console.log('page errors:', errors.length ? errors.slice(0, 8) : 'none')

await browser.close()
server.close()
if (errors.length) process.exit(1)
