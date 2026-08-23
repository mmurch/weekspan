/**
 * Drives the wired app in a real browser. Unit tests cover each module; this
 * covers the seams between them, which is where every bug in this project has
 * actually lived.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4325,r))

const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2})
const errors=[]
p.on('pageerror',e=>errors.push(String(e)))
p.on('console',m=>{if(m.type()==='error')errors.push(m.text())})

// Pin zoom to 100% so the probe isolates interaction from the zoom coordinate
// question; zoom is covered separately.
await p.addInitScript(() => { try { localStorage.setItem('weekspan.zoom','1') } catch {} })
await p.goto('http://localhost:4325/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

const results = []
const check = (name, pass, detail='') => { results.push({name,pass,detail}); }

// 1. Renders through the store rather than straight from a fixture.
const rows = await p.locator('[data-row-id]').count()
check('renders via store', rows > 0, `${rows} rows`)

// 2. Click selects a cell.
// An empty cell: pressing D on a cell that already has a due correctly changes
// nothing, which would make this assertion meaningless.
const firstCell = p.locator('[data-cell-date]:not(:has(.ws-chip))').first()
await firstCell.click()
await p.waitForTimeout(150)
check('click selects', await p.locator('.ws-cell--selected').count() === 1)

// 3. Keyboard sets a mark, and it reaches the store.
const beforeDue = await p.locator('.ws-chip--due').count()
await p.keyboard.press('d')
await p.waitForTimeout(250)
const afterDue = await p.locator('.ws-chip--due').count()
check('D sets a due', afterDue === beforeDue + 1, `${beforeDue} -> ${afterDue}`)

// 4. V marks done.
const beforeDone = await p.locator('.ws-chip--done').count()
await p.keyboard.press('v')
await p.waitForTimeout(250)
check('V sets done', await p.locator('.ws-chip--done').count() === beforeDone + 1)

// 5. X clears.
await p.keyboard.press('x')
await p.waitForTimeout(250)
check('X clears', await p.locator('.ws-chip--done').count() === beforeDone)

// 6. Arrow moves selection without losing it.
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(150)
check('arrow moves selection', await p.locator('.ws-cell--selected').count() === 1)

// 7. Escape deselects.
await p.keyboard.press('Escape')
await p.waitForTimeout(150)
check('escape deselects', await p.locator('.ws-cell--selected').count() === 0)

// 8. Cmd+K opens quick capture.
await p.keyboard.press('Meta+k')
await p.waitForTimeout(250)
const captureOpen = await p.locator('input').count() > 0
check('cmd-K opens capture', captureOpen)
if (captureOpen) { await p.keyboard.press('Escape'); await p.waitForTimeout(150) }

// 9. Right-click opens the cell menu.
await p.locator('[data-cell-date]').nth(12).click({ button: 'right' })
await p.waitForTimeout(250)
const menuVisible = await p.locator('[role="menu"], .ws-cell-menu').count()
check('right-click opens menu', menuVisible > 0, `${menuVisible} menus`)
await p.keyboard.press('Escape')

console.log('')
for (const r of results) console.log(`${r.pass?'  PASS':'  FAIL'}  ${r.name}${r.detail?`  (${r.detail})`:''}`)
console.log('')
console.log('page errors:', errors.length ? errors.slice(0,4) : 'none')
await p.screenshot({path:'shots/08-wired.png'})
await b.close(); server.close()
if (results.some(r=>!r.pass) || errors.length) process.exit(1)
