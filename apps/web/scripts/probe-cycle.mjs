import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4329,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}})
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4329/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

// A blank cell on a NON-recurring row.
const cell = p.locator('[data-row-id="item-water-plants"] [data-cell-date="2026-09-01"]')
const state = async () => p.evaluate(() => {
  const c = document.querySelector('[data-row-id="item-water-plants"] [data-cell-date="2026-09-01"]')
  const chip = c?.querySelector('.ws-chip')
  return chip ? (chip.className.match(/ws-chip--(\w+)/)?.[1] ?? '?') : 'blank'
})
const seq = [await state()]
for (let i=0;i<3;i++){ await cell.click(); await p.waitForTimeout(200); seq.push(await state()) }
console.log('RECURRING click cycle:', seq.join(' -> '))

// Enter on a selected cell must do the same thing.
await p.keyboard.press('Enter'); await p.waitForTimeout(200)
console.log('after Enter            :', await state())
await b.close();server.close()
