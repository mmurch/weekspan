import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4328,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2})
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4328/?today=2026-08-26&fixture=stress&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

const closeBtns = await p.locator('.ws-week-close').count()
const blocked = await p.locator('.ws-week-close--blocked').count()
console.log(`close affordances: ${closeBtns} (blocked-style: ${blocked})`)

if (closeBtns > 0) {
  await p.locator('.ws-week-close').first().click()
  await p.waitForTimeout(300)
  const panelText = await p.locator('body').innerText()
  const hasExplanation = /cannot close|blocking|recurs|due/i.test(panelText)
  console.log('clicking it explains the situation:', hasExplanation ? 'YES' : 'NO')
  await p.screenshot({path:'shots/09-closeout-panel.png'})
}
await b.close();server.close()
