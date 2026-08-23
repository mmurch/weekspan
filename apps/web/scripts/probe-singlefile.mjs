import { chromium } from 'playwright'
import path from 'node:path'
const file = path.resolve('dist-single/weekspan.html')
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await p.goto(`file://${file}?today=2026-08-26&fixture=demo&theme=paper`)
await p.waitForTimeout(1500)

const r = await p.evaluate(() => ({
  cells: document.querySelectorAll('[data-cell-date]').length,
  rows: document.querySelectorAll('[data-row-id]').length,
  isSecureContext: window.isSecureContext,
  canPickFile: typeof window.showOpenFilePicker === 'function',
  canPickDir: typeof window.showDirectoryPicker === 'function',
}))
console.log('single file over file:// →', JSON.stringify(r, null, 1))
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none')
await p.screenshot({ path: 'shots/06-singlefile-fileproto.png' })
await b.close()
