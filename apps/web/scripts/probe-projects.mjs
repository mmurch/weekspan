import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4340,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},50000)
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2})
const errs=[];p.on('pageerror',e=>errs.push(String(e)))
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4340/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

// 1. Toggle to Project view.
await p.getByRole('button',{name:'Project'}).click()
await p.waitForTimeout(300)
const dividers = await p.locator('.ws-divider').count()
console.log('project view dividers   :', dividers)
const names = await p.locator('.ws-divider-name').allTextContents()
console.log('groups                  :', names.join(' | '))

// 2. Every item still visible (nothing lost by grouping).
const rowsPriority = await p.evaluate(()=>document.querySelectorAll('[data-row-id]').length)
console.log('rows in project view    :', rowsPriority)

// 3. Collapse a group.
await p.locator('.ws-divider-disclosure').first().click()
await p.waitForTimeout(250)
const afterCollapse = await p.evaluate(()=>document.querySelectorAll('[data-row-id]').length)
console.log('collapse hides rows     :', afterCollapse < rowsPriority ? `YES (${rowsPriority}->${afterCollapse})` : 'NO')
await p.locator('.ws-divider-disclosure').first().click()
await p.waitForTimeout(200)

// 4. Colour picker opens from the swatch.
await p.locator('.ws-divider-swatch:not(.ws-divider-swatch--none)').first().click()
await p.waitForTimeout(300)
const pickerOpen = await p.locator('[class*="colorpicker" i], [class*="color-picker" i]').count()
console.log('colour picker opens     :', pickerOpen>0 ? 'YES':'NO')
await p.keyboard.press('Escape')
await p.waitForTimeout(200)

// 5. Create a project via quick capture with Cmd+Enter.
const before = await p.locator('.ws-divider-name').count()
await p.keyboard.press('Meta+k')
await p.waitForTimeout(250)
await p.keyboard.type('Garden')
await p.keyboard.press('Meta+Enter')
await p.waitForTimeout(400)
const after = await p.locator('.ws-divider-name').allTextContents()
console.log('cmd-enter makes project :', after.includes('Garden') ? 'YES' : `NO (${after.join('|')})`)

// 6. Back to Priority view.
await p.getByRole('button',{name:'Priority'}).click()
await p.waitForTimeout(250)
console.log('priority has no dividers:', await p.locator('.ws-divider').count()===0 ? 'YES':'NO')
console.log('errors:', errs.length?errs.slice(0,3):'none')
await p.getByRole('button',{name:'Project'}).click()
await p.waitForTimeout(300)
await p.screenshot({path:'shots/14-project-view.png'})
clearTimeout(KILL);await b.close();server.close();process.exit(0)
