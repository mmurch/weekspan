import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4334,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},45000)
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2})
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4334/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)
const order=()=>p.evaluate(()=>[...document.querySelectorAll('[data-row-id]')].map(r=>r.getAttribute('data-row-id')))

const start = await order()
const g = await p.locator('[data-row-id] .ws-grip').first().boundingBox()
const t3 = await p.locator('[data-row-id] .ws-title').nth(3).boundingBox()

await p.mouse.move(g.x+g.width/2, g.y+g.height/2)
await p.mouse.down()
await p.mouse.move(g.x+g.width/2, t3.y+t3.height/2, {steps:12})
await p.waitForTimeout(150)

// The crucial check: has the DOM order already changed, before release?
const midDrag = await order()
const lifted = await p.locator('.ws-row--dragging').count()
await p.screenshot({path:'shots/12-drag-live.png'})
await p.mouse.up()
await p.waitForTimeout(300)
const final = await order()

console.log('start    :', start.slice(0,4).join(', '))
console.log('mid-drag :', midDrag.slice(0,4).join(', '))
console.log('released :', final.slice(0,4).join(', '))
console.log('')
console.log('moves DURING drag        :', JSON.stringify(start)!==JSON.stringify(midDrag) ? 'YES' : 'NO')
console.log('lifted row styled        :', lifted>0 ? 'YES' : 'NO')
console.log('release matches preview  :', JSON.stringify(midDrag)===JSON.stringify(final) ? 'YES' : 'NO')
clearTimeout(KILL)
await b.close();server.close()
process.exit(0)
