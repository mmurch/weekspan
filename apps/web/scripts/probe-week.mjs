import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4350,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},60000)
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1700,height:1000},deviceScaleFactor:2})
const errs=[];p.on('pageerror',e=>errs.push(String(e)))
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4350/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)
const rows=()=>p.evaluate(()=>document.querySelectorAll('[data-row-id]').length)

// 1. Theme picker
await p.locator('.ws-theme-picker button, [class*="theme"] button').first().click().catch(()=>{})
await p.waitForTimeout(250)
console.log('theme picker opens :', await p.locator('[class*="theme"] [role="menu"], [class*="theme-menu"], [class*="themepicker"]').count()>0 ? 'YES':'NO')
await p.keyboard.press('Escape')

// 2. Filter
const all = await rows()
await p.locator('input[type="text"], .ws-filter-field input').first().fill('tiles')
await p.waitForTimeout(350)
const filteredCount = await rows()
console.log('filter narrows     :', filteredCount < all ? `YES (${all}->${filteredCount})` : `NO (${all}->${filteredCount})`)
await p.locator('input[type="text"], .ws-filter-field input').first().fill('')
await p.waitForTimeout(300)

// 3. Vacation toggle via day header
const vacBefore = await p.locator('.ws-day-disc--vacation').count()
await p.locator('.ws-day').nth(3).click()
await p.waitForTimeout(400)
const vacAfter = await p.locator('.ws-day-disc--vacation').count()
console.log('vacation toggles   :', vacAfter !== vacBefore ? `YES (${vacBefore}->${vacAfter})` : 'NO')

// 4. Notes editing
await p.locator('.ws-notes').first().click()
await p.waitForTimeout(300)
console.log('notes editable     :', await p.locator('.ws-inline-edit').count()>0 ? 'YES':'NO')
await p.keyboard.press('Escape')

// 5. Bulk import preview
await p.keyboard.press('Meta+k')
await p.waitForTimeout(250)
await p.locator('textarea').first().fill('first task\nsecond task thu\nthird task')
await p.waitForTimeout(400)
const bodyText = await p.locator('body').innerText()
console.log('bulk preview shows :', /3 item|Create 3/i.test(bodyText) ? 'YES' : 'NO')
await p.keyboard.press('Escape')

console.log('errors:', errs.length?errs.slice(0,3):'none')
await p.screenshot({path:'shots/15-week-features.png'})
clearTimeout(KILL);await b.close();server.close();process.exit(0)
