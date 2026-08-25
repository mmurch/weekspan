#!/usr/bin/env node
/**
 * Build the artifact you send to another machine.
 *
 * The important fact about this app, and the one that decides the whole
 * distribution question: `apps/web` builds to ONE self-contained HTML file.
 * Every script, style and font reference is inlined, so it runs from `file://`
 * with no server, no `npm install`, and no Node on the receiving machine. The
 * repo is not a prerequisite for USING weekspan — only for changing it.
 *
 * So the answer to "should I zip the repo and Slack it to myself" is no: zip
 * the 260KB HTML file instead, or just send the file. This script stages both,
 * plus the CLI bundle for anyone who wants the agent-facing write path too.
 *
 * Why a .zip at all, when a single .html would do: corporate Slack and mail
 * filters routinely strip or refuse `.html` attachments, and browsers like to
 * render one inline rather than save it. A .zip survives that trip intact. Both
 * are emitted — send whichever gets through.
 *
 * Everything lands in `dist-release/`, which is git-ignored and rebuilt from
 * scratch on every run so a stale file can never ride along in a release.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-release')

function run(cmd, args, cwd = root) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

function kb(path) {
  return `${Math.round(statSync(path).size / 1024)}KB`
}

console.log('→ building the single-file web app')
run('npm', ['run', 'build:single', '-w', '@weekspan/web'])

console.log('→ building the CLI bundle')
run('npm', ['run', 'build', '-w', '@weekspan/cli'])

const webSrc = join(root, 'apps/web/dist-single/weekspan.html')
const cliSrc = join(root, 'packages/cli/dist/index.js')
for (const [label, path] of [['web', webSrc], ['cli', cliSrc]]) {
  if (!existsSync(path)) {
    console.error(`\nBuild did not produce the ${label} artifact at ${path}.`)
    process.exit(1)
  }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(webSrc, join(out, 'weekspan.html'))
cpSync(cliSrc, join(out, 'weekspan-cli.mjs'))

// `init` writes a JSON Schema and the agent-facing AGENTS.md / CLAUDE.md beside
// a new ledger, and it finds all three by walking RELATIVE to its own file. The
// bundle leaves the workspace, so those walks fail and `init` degrades to a
// bare ledger with a warning. Shipping the sidecars beside the bundle is what
// keeps the packaged CLI equal to the one in the repo.
cpSync(join(root, 'packages/weekspan-core/weekspan.schema.json'), join(out, 'weekspan.schema.json'))
cpSync(join(root, 'packages/cli/templates'), join(out, 'templates'), { recursive: true })

// Written into the artifact, not just the repo: in six months this folder may be
// all that is left of the context, and it has to explain itself without one.
writeFileSync(
  join(out, 'READ-ME-FIRST.txt'),
  `weekspan
========

weekspan.html
-------------
The whole app, in one file. Nothing to install.

  1. Save it somewhere permanent (NOT Downloads — see below).
  2. Open it in Chrome or Edge. Firefox and Safari will not work: the app
     uses the File System Access API to read and write your ledger file
     directly, and only Chromium browsers implement it.
  3. Click to open (or create) your .weekspan.json ledger file.

The browser remembers which file you picked, so subsequent opens go straight
back to it. That permission is tied to the file's LOCATION, so moving the
HTML file or the ledger after the fact means re-granting it — hence "save it
somewhere permanent".

Your data lives in the .weekspan.json file you choose, never inside this HTML
file and never on a server. Back that up, not this.

One external request: the page pulls IBM Plex from fonts.googleapis.com. If a
corporate proxy blocks it, the app still works — it falls back to the system
sans-serif and nothing else changes. No app code or data is fetched remotely.

weekspan-cli.mjs
----------------
Optional. The command-line client, for scripting and for AI agents. Needs
Node 18 or newer.

  node weekspan-cli.mjs status
  node weekspan-cli.mjs add "call the plumber" --due thu
  node weekspan-cli.mjs --help

Point it at a ledger with --weekspan <path>, or set WEEKSPAN_FILE.

Both clients read and write the same file format and can be used against the
same ledger.
`,
)

const files = [
  'weekspan.html',
  'weekspan-cli.mjs',
  'READ-ME-FIRST.txt',
  'weekspan.schema.json',
  'templates',
]
let zipped = false
try {
  // `zip` ships with macOS and most Linux. Failing to zip is not fatal — the
  // loose files are still a perfectly good artifact — so this degrades to a
  // warning rather than taking the whole release down with it.
  // No -j: `templates/` must keep its directory, since that is where `init`
  // looks for it.
  run('zip', ['-q', '-r', 'weekspan-release.zip', ...files], out)
  zipped = true
} catch {
  console.warn('  (could not run `zip` — sending the loose files works just as well)')
}

console.log('\nReady in dist-release/')
console.log(`  weekspan.html      ${kb(join(out, 'weekspan.html'))}  ← the app; this is all you need`)
console.log(`  weekspan-cli.mjs   ${kb(join(out, 'weekspan-cli.mjs'))}  ← optional CLI (needs Node 18+)`)
console.log('  READ-ME-FIRST.txt')
if (zipped) console.log(`  weekspan-release.zip ${kb(join(out, 'weekspan-release.zip'))}  ← send this if .html is blocked`)
console.log('\nSend it to yourself, save it somewhere permanent, open it in Chrome or Edge.')
