import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4330,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:700}})
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4330/?today=2026-08-26&fixture=stress&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

const scrollBefore = await p.evaluate(()=>document.querySelector('.ws-scroll').scrollTop)
await p.keyboard.press('Space')
await p.waitForTimeout(300)
const open = await p.locator('textarea').count()
const scrollAfter = await p.evaluate(()=>document.querySelector('.ws-scroll').scrollTop)
console.log('space opens capture :', open>0 ? 'YES' : 'NO')
console.log('space did NOT scroll:', scrollBefore===scrollAfter ? 'YES' : `NO (${scrollBefore}->${scrollAfter})`)

// Typing a space INSIDE the capture must type, not re-trigger.
await p.keyboard.type('buy milk thu')
await p.waitForTimeout(200)
const val = await p.locator('textarea').inputValue()
console.log('typing inside works :', val.includes('buy milk') ? `YES ("${val}")` : `NO ("${val}")`)

// Long text must stay visible (multiline), not scroll out of sight.
await p.locator('textarea').fill('a'.repeat(60)+' '+'b'.repeat(60)+' '+'c'.repeat(60))
await p.waitForTimeout(200)
const box = await p.locator('textarea').boundingBox()
console.log('textarea grew       :', box.height > 40 ? `YES (${Math.round(box.height)}px)` : `NO (${Math.round(box.height)}px)`)
await p.screenshot({path:'shots/10-capture-multiline.png'})
await b.close();server.close()
