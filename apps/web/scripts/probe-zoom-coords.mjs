/**
 * Does CSS zoom on the root break the app for a REAL user?
 *
 * Playwright's synthetic clicks were misplaced under zoom, but a real browser
 * generates clicks at the visual location — so the question is narrower: does the
 * context menu, positioned from `clientX`/`clientY`, land under the cursor?
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4327,r))
const b=await chromium.launch()

for (const zoom of ['1','1.1','1.5']) {
  const p = await b.newPage({viewport:{width:1600,height:1000}})
  await p.addInitScript(z => { try { localStorage.setItem('weekspan.zoom', z) } catch {} }, zoom)
  await p.goto('http://localhost:4327/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
  await p.evaluate(()=>document.fonts.ready)

  // Dispatch a contextmenu event at a known VISUAL point, the way a real mouse
  // would, then measure where the menu actually rendered.
  const r = await p.evaluate(() => {
    const cell = document.querySelectorAll('[data-cell-date]')[12]
    const rect = cell.getBoundingClientRect()
    const x = Math.round(rect.left + rect.width/2)
    const y = Math.round(rect.top + rect.height/2)
    cell.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:x, clientY:y}))
    return new Promise(res => setTimeout(() => {
      const menu = document.querySelector('.ws-cellmenu')
      if (!menu) return res({ clicked:{x,y}, menu:null })
      const m = menu.getBoundingClientRect()
      res({ clicked:{x,y}, menu:{l:Math.round(m.left), t:Math.round(m.top)},
            zoomProp: getComputedStyle(document.documentElement).zoom })
    }, 200))
  })
  const dx = r.menu ? r.menu.l - r.clicked.x : null
  const dy = r.menu ? r.menu.t - r.clicked.y : null
  console.log(`zoom ${zoom}: click(${r.clicked.x},${r.clicked.y}) menu(${r.menu?.l},${r.menu?.t}) offset(${dx},${dy}) computedZoom=${r.zoomProp}`)
  await p.close()
}
await b.close(); server.close()
