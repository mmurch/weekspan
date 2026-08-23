import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST = '/Users/mmurch/code/murch-todo/apps/web/dist'
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }
const server = createServer(async (req,res)=>{
  const url=(req.url??'/').split('?')[0]; const f=path.join(DIST, url==='/'?'index.html':url.slice(1))
  try{ const b=await readFile(f); res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'}); res.end(b) }
  catch{ res.writeHead(200,{'content-type':'text/html'}); res.end(await readFile(path.join(DIST,'index.html'))) }
})
await new Promise(r=>server.listen(4321,r))
const b = await chromium.launch(); const p = await b.newPage()
for (const theme of ['paper','solarized','warm']) {
  await p.goto(`http://localhost:4321/?today=2026-08-26&theme=${theme}&fixture=demo`,{waitUntil:'networkidle'})
  const r = await p.evaluate(()=>{
    const cs = (sel,prop)=>{const el=document.querySelector(sel); return el?getComputedStyle(el)[prop]:'MISSING'}
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      topbar: cs('.ws-topbar','backgroundColor'),
      filepicker: cs('.ws-filepicker','backgroundColor'),
      filepickerText: cs('.ws-filepicker','color'),
      rail: cs('.ws-rail','backgroundColor'),
      title: cs('.ws-title-text','color'),
      subtleVar: getComputedStyle(document.documentElement).getPropertyValue('--ws-subtle').trim(),
      dataTheme: document.documentElement.getAttribute('data-theme'),
    }
  })
  console.log(theme, JSON.stringify(r,null,1))
}
await b.close(); server.close()
