import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4332,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}})
await p.goto('http://localhost:4332/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
const r = await p.evaluate(()=>{
  const rows=[...document.querySelectorAll('[data-row-id]')].slice(0,3)
  return rows.map(el=>{
    const b=el.getBoundingClientRect()
    const title=el.querySelector('.ws-title')?.getBoundingClientRect()
    return {id:el.getAttribute('data-row-id'), display:getComputedStyle(el).display,
            rowBox:{top:Math.round(b.top),h:Math.round(b.height)},
            titleBox:title?{top:Math.round(title.top),h:Math.round(title.height)}:null}
  })
})
console.log(JSON.stringify(r,null,1))
await b.close();server.close()
