import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4337,r))
const KILL=setTimeout(()=>{process.exit(2)},40000)
const b=await chromium.launch()
// The picker screen (no ?fixture) at zoom, plus a narrow window where the grid
// genuinely overflows horizontally.
for (const [label,url,vp,zoom] of [
  ['picker @150%','/', {width:1440,height:900}, '1.5'],
  ['grid narrow @110%','/?today=2026-08-26&fixture=stress&theme=paper', {width:900,height:600}, '1.1'],
]) {
  const p=await b.newPage({viewport:vp})
  await p.addInitScript(z=>{try{localStorage.setItem('weekspan.zoom',z)}catch{}},zoom)
  await p.goto('http://localhost:4337'+url,{waitUntil:'networkidle'})
  await p.evaluate(()=>document.fonts.ready)
  const r=await p.evaluate(()=>{const d=document.documentElement;return{
    docY:d.scrollHeight>d.clientHeight, docX:d.scrollWidth>d.clientWidth,
    dims:`${d.scrollWidth}x${d.scrollHeight} vs ${d.clientWidth}x${d.clientHeight}`}})
  console.log(`${label}: docScrollY=${r.docY} docScrollX=${r.docX}  (${r.dims})`)
  await p.close()
}
clearTimeout(KILL);await b.close();server.close();process.exit(0)
