/**
 * Drag is pointer-driven, so none of it is reachable by unit test in a project
 * with no jsdom. This drives real pointer events in a real browser.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4331,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}})
const errs=[];p.on('pageerror',e=>errs.push(String(e)))
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4331/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

const order = () => p.evaluate(()=>[...document.querySelectorAll('[data-row-id]')].map(r=>r.getAttribute('data-row-id')))
const before = await order()
console.log('before:', before.slice(0,4).join(', '))

// Drag row 1's grip down past rows 2 and 3.
const grip = p.locator('[data-row-id] .ws-grip').first()
const g = await grip.boundingBox()
const target = await p.locator('[data-row-id] .ws-title').nth(3).boundingBox()
await p.mouse.move(g.x+g.width/2, g.y+g.height/2)
await p.mouse.down()
await p.mouse.move(g.x+g.width/2, g.y+20, {steps:5})
const indicator = await p.locator('.ws-row--dragging').count()
await p.mouse.move(target.x+target.width/2, target.y+target.height/2, {steps:10})
await p.screenshot({path:'shots/11-dragging.png'})
await p.mouse.up()
await p.waitForTimeout(400)
const after = await order()
console.log('after :', after.slice(0,4).join(', '))
console.log('live preview shown  :', indicator>0 ? 'YES' : 'NO')
console.log('order changed    :', JSON.stringify(before)!==JSON.stringify(after) ? 'YES' : 'NO')

// A plain click on the grip must NOT reorder.
const beforeClick = await order()
await grip.click()
await p.waitForTimeout(300)
console.log('click does nothing:', JSON.stringify(beforeClick)===JSON.stringify(await order()) ? 'YES' : 'NO')

// Escape mid-drag must cancel with no write.
const beforeEsc = await order()
const g2 = await p.locator('[data-row-id] .ws-grip').first().boundingBox()
await p.mouse.move(g2.x+g2.width/2, g2.y+g2.height/2)
await p.mouse.down()
await p.mouse.move(g2.x+g2.width/2, g2.y+120, {steps:8})
await p.keyboard.press('Escape')
await p.mouse.up()
await p.waitForTimeout(300)
console.log('escape cancels    :', JSON.stringify(beforeEsc)===JSON.stringify(await order()) ? 'YES' : 'NO')
console.log('errors:', errs.length?errs.slice(0,3):'none')
await b.close();server.close()
