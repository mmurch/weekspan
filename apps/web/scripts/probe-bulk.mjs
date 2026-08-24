import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const DIST=path.resolve('dist');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const f=path.join(DIST,u==='/'?'index.html':u.slice(1))
 try{const b=await readFile(f);res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(b)}
 catch{res.writeHead(200,{'content-type':'text/html'});res.end(await readFile(path.join(DIST,'index.html')))}})
await new Promise(r=>server.listen(4351,r))
const KILL=setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},45000)
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1700,height:1000}})
const errs=[];p.on('pageerror',e=>errs.push(String(e)))
await p.addInitScript(()=>{try{localStorage.setItem('weekspan.zoom','1')}catch{}})
await p.goto('http://localhost:4351/?today=2026-08-26&fixture=demo&theme=paper',{waitUntil:'networkidle'})
await p.evaluate(()=>document.fonts.ready)
const rows=()=>p.evaluate(()=>document.querySelectorAll('[data-row-id]').length)
const before = await rows()

await p.keyboard.press('Meta+k')
await p.waitForTimeout(250)
// Type rather than fill, so React sees each keystroke like a real paste would.
// Shift+Enter inserts a literal newline (plain Enter submits). A synthetic
// paste event is untrusted and inserts nothing, so this is the reliable way to
// build multi-line content through the real component path.
const box = p.locator('textarea').first()
await box.focus()
await box.type('alpha task')
await p.keyboard.press('Shift+Enter')
await box.type('beta task thu')
await p.keyboard.press('Shift+Enter')
await box.type('gamma task')
await p.waitForTimeout(400)
await p.waitForTimeout(500)
const ta = await p.locator('textarea').first().inputValue()
console.log('textarea lines     :', JSON.stringify(ta).slice(0,60))
console.log('preview element    :', await p.locator('[class*="bulk"]').count())
const txt = await p.locator('body').innerText()
console.log('has "Create"       :', /Create \d+ item/i.test(txt) ? 'YES' : 'NO')

// Confirm via the explicit button, which is the only path that should write.
const btn = p.locator('[class*="bulk"] button').first()
if (await btn.count() > 0) {
  await btn.click()
  await p.waitForTimeout(600)
  const after = await rows()
  console.log('import created     :', after - before, 'rows')
}
console.log('errors:', errs.length?errs.slice(0,2):'none')
clearTimeout(KILL);await b.close();server.close();process.exit(0)
