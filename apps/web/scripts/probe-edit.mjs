import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4335,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},45000)
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2})
const errs=[];p.on('pageerror',e=>errs.push(String(e)))
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4335/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

const titles = () => p.evaluate(()=>[...document.querySelectorAll('.ws-title-text')].map(e=>e.textContent))

// 1. Click a title to edit it.
const before = await titles()
await p.locator('.ws-title-text').first().click()
await p.waitForTimeout(200)
console.log('click opens editor :', await p.locator('.ws-inline-edit').count()>0 ? 'YES':'NO')
await p.keyboard.type('renamed by test')
await p.keyboard.press('Enter')
await p.waitForTimeout(300)
const after = await titles()
console.log('rename committed   :', after[0]==='renamed by test' ? 'YES' : `NO ("${after[0]}")`)

// 2. Escape cancels.
await p.locator('.ws-title-text').nth(1).click()
await p.waitForTimeout(150)
await p.keyboard.type('should not stick')
await p.keyboard.press('Escape')
await p.waitForTimeout(250)
console.log('escape cancels     :', (await titles())[1]===before[1] ? 'YES' : 'NO')

// 3. Seam inserts between two rows.
const countBefore = (await titles()).length
const seam = p.locator('.ws-seam').nth(2)
await seam.click({force:true})
await p.waitForTimeout(200)
const draftOpen = await p.locator('.ws-row--draft .ws-inline-edit').count()>0
console.log('seam opens draft   :', draftOpen ? 'YES':'NO')
if (draftOpen) {
  await p.keyboard.type('inserted between')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(350)
  const t = await titles()
  console.log('insert committed   :', t.includes('inserted between') ? `YES (at ${t.indexOf('inserted between')})` : 'NO')
  console.log('count grew by one  :', t.length===countBefore+1 ? 'YES' : `NO (${countBefore}->${t.length})`)
}
console.log('errors:', errs.length?errs.slice(0,3):'none')
await p.screenshot({path:'shots/13-inline-edit.png'})
clearTimeout(KILL); await b.close(); server.close(); process.exit(0)
