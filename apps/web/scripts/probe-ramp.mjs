/**
 * Screenshots the six-token project bar ramp and the ProjectColorPicker in
 * all three themes, via the standalone `ramp-probe.html` harness (see that
 * file and src/projects/rampProbeMain.tsx) — App.tsx/Grid.tsx are untouched,
 * so this is the only way to see either in the real, built CSS cascade.
 *
 * Same convention as scripts/shots.mjs: serves the production build from
 * dist/, not the dev server, so what's captured is what actually ships.
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
    const rel = url === '/' ? 'ramp-probe.html' : url.slice(1)
    const file = path.join(DIST, rel)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

const THEMES = ['paper', 'solarized', 'warm']
const PORT = 4329

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
  await page.goto(`http://localhost:${PORT}/ramp-probe.html?theme=${theme}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(OUT, `ramp-${theme}.png`) })
  console.log(`shot: ramp-${theme}`)
}

console.log('')
console.log('page errors:', errors.length ? errors.slice(0, 8) : 'none')

await browser.close()
server.close()
if (errors.length) process.exit(1)
