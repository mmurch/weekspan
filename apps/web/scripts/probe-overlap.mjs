import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4326,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}})
await p.goto('http://localhost:4326/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)
const r = await p.evaluate(()=>{
  const scroll = document.querySelector('.ws-scroll')
  const firstRow = document.querySelector('[data-row-id]')
  const cells = [...firstRow.querySelectorAll('[data-cell-date]')].slice(0,4)
  const title = firstRow.querySelector('.ws-title')
  const grip = firstRow.querySelector('.ws-grip')
  const rect = e => { const x=e.getBoundingClientRect(); return {l:Math.round(x.left),r:Math.round(x.right),w:Math.round(x.width)} }
  // what is actually on top at the centre of the first cell?
  const c0 = cells[0].getBoundingClientRect()
  const topAt = document.elementFromPoint(c0.left + c0.width/2, c0.top + c0.height/2)
  return {
    zoomStyle: scroll.style.zoom,
    grip: rect(grip), title: rect(title),
    cells: cells.map(c=>({date:c.getAttribute('data-cell-date'), ...rect(c)})),
    topElementAtFirstCell: topAt ? `${topAt.className} ${topAt.getAttribute?.('data-cell-date')??''}` : 'none',
  }
})
console.log(JSON.stringify(r,null,1))
await b.close();server.close()
