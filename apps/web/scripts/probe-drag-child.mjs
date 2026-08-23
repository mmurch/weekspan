import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4333,r))
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}})
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4333/?today=2026-08-26&fixture=stress&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)

// Find a child row and its parent.
const info = await p.evaluate(()=>{
  const rows=[...document.querySelectorAll('[data-row-id]')]
  const childIdx = rows.findIndex(r=>r.querySelector('.ws-title--child'))
  return { childIdx, childId: rows[childIdx]?.getAttribute('data-row-id'),
           parentId: rows[childIdx-1]?.getAttribute('data-row-id') }
})
console.log('child:', info.childId, '| parent:', info.parentId)

const grip = p.locator(`[data-row-id="${info.childId}"] .ws-grip`)
const g = await grip.boundingBox()
// Try to drag it far up, well outside its parent group.
await p.mouse.move(g.x+g.width/2, g.y+g.height/2)
await p.mouse.down()
await p.mouse.move(g.x+g.width/2, g.y-300, {steps:12})
await p.mouse.up()
await p.waitForTimeout(400)

const after = await p.evaluate((ids)=>{
  const rows=[...document.querySelectorAll('[data-row-id]')].map(r=>r.getAttribute('data-row-id'))
  const ci = rows.indexOf(ids.childId), pi = rows.indexOf(ids.parentId)
  return { stillAfterParent: ci === pi+1, childIdx: ci, parentIdx: pi }
}, info)
console.log('child still directly under its parent:', after.stillAfterParent ? 'YES' : `NO (child ${after.childIdx}, parent ${after.parentIdx})`)
await b.close();server.close()
