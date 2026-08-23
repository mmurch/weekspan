import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4324,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:900,height:800},deviceScaleFactor:2})
await p.goto('http://localhost:4324/?today=2026-08-26&fixture=stress&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)
await p.evaluate(()=>document.querySelector('.ws-scroll').scrollTo(600,700))
await p.waitForTimeout(300)
// EVERY title must share one left edge — child rows included.
const r=await p.evaluate(()=>{
  const lefts=[...document.querySelectorAll('.ws-title')].map(e=>Math.round(e.getBoundingClientRect().left))
  const childLefts=[...document.querySelectorAll('.ws-title--child')].map(e=>Math.round(e.getBoundingClientRect().left))
  return {distinct:[...new Set(lefts)], distinctChild:[...new Set(childLefts)], titles:lefts.length, children:childLefts.length}
})
console.log(JSON.stringify(r))
console.log(r.distinct.length===1 ? 'ALL titles frozen at one x' : 'MISALIGNED: '+r.distinct.join(','))
await p.screenshot({path:'shots/07-stress-scrolled.png'})
await b.close();server.close()
