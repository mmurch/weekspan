import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4352,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},45000)
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1700,height:1000}})
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4352/?today=2026-08-26&fixture=demo&theme=project',{waitUntil:'networkidle'})
await p.goto('http://localhost:4352/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

// The real path: quick capture with a project word in it.
await p.keyboard.press('Meta+k')
await p.waitForTimeout(250)
await p.locator('textarea').first().type('order tile samples kitchen')
await p.waitForTimeout(350)
console.log('preview names project:', /kitchen/i.test(await p.locator('body').innerText()) ? 'YES':'NO')
await p.keyboard.press('Enter')
await p.waitForTimeout(500)

// Switch to Project view and see which group it actually landed in.
await p.getByRole('button',{name:'Project'}).click()
await p.waitForTimeout(400)
const placed = await p.evaluate(() => {
  const out = []
  let group = null
  for (const el of document.querySelectorAll('.ws-divider, [data-row-id]')) {
    if (el.classList.contains('ws-divider')) group = el.querySelector('.ws-divider-name')?.textContent
    else if (el.textContent?.includes('order tile samples')) out.push(group)
  }
  return out
})
console.log('item filed under     :', placed.length ? placed.join(', ') : 'NOT FOUND')
clearTimeout(KILL);await b.close();server.close();process.exit(0)
