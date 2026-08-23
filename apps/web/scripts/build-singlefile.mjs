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
import path from 'node:path'

const OUT = path.resolve('dist-single')

await build({
  root: process.cwd(),
  base: './',
  plugins: [react()],
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
