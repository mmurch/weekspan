import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4336,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},40000)
const b=await chromium.launch()
for (const zoom of ['1','1.1','1.5']) {
  const p=await b.newPage({viewport:{width:1440,height:900}})
  await p.addInitScript(z=>{try{localStorage.setItem('weekspan.zoom',z)}catch{}},zoom)
  await p.goto('http://localhost:4336/?today=2026-08-26&fixture=stress&theme=paper',{waitUntil:'networkidle'})
  await p.evaluate(()=>document.fonts.ready)
  const r=await p.evaluate(()=>{
    const d=document.documentElement, bd=document.body
    const sc=document.querySelector('.ws-scroll')
    return {
      docScrollsY: d.scrollHeight > d.clientHeight, docScrollsX: d.scrollWidth > d.clientWidth,
      bodyScrollsY: bd.scrollHeight > bd.clientHeight, bodyScrollsX: bd.scrollWidth > bd.clientWidth,
      innerScrollsY: sc ? sc.scrollHeight > sc.clientHeight : null,
      innerScrollsX: sc ? sc.scrollWidth > sc.clientWidth : null,
      doc:`${d.scrollWidth}x${d.scrollHeight} vs ${d.clientWidth}x${d.clientHeight}`,
    }
  })
  console.log(`zoom ${zoom}:`, JSON.stringify(r))
  await p.close()
}
clearTimeout(KILL);await b.close();server.close();process.exit(0)
