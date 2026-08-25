/**
 * Build a single self-contained index.html that runs from file://.
 *
 * Two constraints force this shape:
 *   1. `<script type="module">` is CORS-blocked on file://, so the bundle must
 *      be a classic IIFE script.
 *   2. Any external <script src> or <link href> is likewise blocked, so JS and
 *      CSS must be inlined rather than referenced.
 *
 * The result is one file you can drop in Drive, email, or double-click. No
 * hosting, no build step for the person receiving it.
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * A build stamp, shown in the app's footer.
 *
 * The app is distributed by copying a file to another machine, so the question
 * "is the thing on screen the thing I just installed?" comes up on every single
 * update and is otherwise unanswerable — two builds look identical. Date plus
 * short SHA answers it at a glance.
 *
 * `WEEKSPAN_BUILD` lets the release packager pass its own stamp so the zip
 * name, the VERSION file and the footer cannot disagree.
 */
function buildStamp() {
  if (process.env.WEEKSPAN_BUILD) return process.env.WEEKSPAN_BUILD
  const date = new Date().toISOString().slice(0, 10)
  let sha = 'nogit'
  try {
    sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    // A copy of the source without .git still builds; it just says so.
  }
  return `${date} ${sha}`
}

const OUT = path.resolve('dist-single')

await build({
  root: process.cwd(),
  base: './',
  plugins: [react()],
  define: { __WEEKSPAN_BUILD__: JSON.stringify(buildStamp()) },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, // inline every asset
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' },
    },
  },
})

let html = await readFile(path.join(OUT, 'index.html'), 'utf8')
const js = await readFile(path.join(OUT, 'app.js'), 'utf8')
let css = ''
try { css = await readFile(path.join(OUT, 'app.css'), 'utf8') } catch { /* no css emitted */ }

/**
 * Replacer FUNCTIONS, not strings. A string replacement runs $-substitution, and
 * a React bundle reliably contains `$'` / `$&` sequences — which would splice
 * chunks of the surrounding HTML back into the output. That produced a file with
 * duplicated <script> tags and a syntax error.
 *
 * `</script>` inside a JS string literal would also close the tag early, so it is
 * escaped.
 */
const safeJs = js.replace(/<\/script>/gi, '<\\/script>')

/**
 * A module script defers until the document is parsed; a classic inline script
 * does not. Leaving it in <head> ran React before #root existed. So the tag is
 * removed from wherever Vite put it and re-inserted immediately before </body>.
 */
html = html
  .replace(/<script[^>]*src="[^"]*app\.js"[^>]*><\/script>/, () => '')
  .replace(/<link[^>]*href="[^"]*app\.css"[^>]*>/, () => `<style>\n${css}\n</style>`)
  .replace(/<\/body>/, () => `<script>\n${safeJs}\n</script>\n</body>`)

if (/src="[^"]*app\.js"/.test(html)) {
  throw new Error('build-singlefile: script tag was not inlined — the bundle would fail over file://')
}

await writeFile(path.join(OUT, 'weekspan.html'), html, 'utf8')
await rm(path.join(OUT, 'index.html'), { force: true })
await rm(path.join(OUT, 'app.js'), { force: true })
await rm(path.join(OUT, 'app.css'), { force: true })

const bytes = Buffer.byteLength(html, 'utf8')
console.log(`dist-single/weekspan.html  ${(bytes / 1024).toFixed(0)} KB`)
