#!/usr/bin/env node
/**
 * Build the zip you send to another machine.
 *
 * The fact that decides the whole distribution question: `apps/web` builds to
 * ONE self-contained HTML file that runs from `file://`. No server, no
 * `npm install`, no Node on the receiving machine. The repo is not a
 * prerequisite for USING weekspan — only for changing it. So this does not zip
 * the repo; it zips a ~260KB app plus the CLI and an installer.
 *
 * The workflow this exists to serve is a LOOP, not a one-off:
 *
 *     here            npm run release        -> dist-release/weekspan-<build>.zip
 *     Slack/email     send it to yourself
 *     there           unzip, ./install.sh    -> ~/weekspan, ledger untouched
 *
 * Which is why the installer travels INSIDE the zip rather than living in the
 * repo: on the receiving machine there is no repo to run a script from, and
 * after the fifth update there is nothing to remember either.
 *
 * The zip is named for its build stamp, and the same stamp goes into VERSION
 * and into the app's own footer — so "which build is this?" has one answer in
 * three places instead of three answers.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-release')

function run(cmd, args, cwd = root, env = {}) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

const kb = (p) => `${Math.round(statSync(p).size / 1024)}KB`

/** `2026-08-25 a94c87b` — date for humans, SHA for exactness. */
function buildStamp() {
  const date = new Date().toISOString().slice(0, 10)
  let sha = 'nogit'
  let dirty = ''
  try {
    sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    // An uncommitted build is a perfectly normal thing to send yourself, but it
    // must not masquerade as the commit it was built from — that SHA no longer
    // identifies what is in the zip.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    if (status.trim() !== '') dirty = '-dirty'
  } catch {
    // Building from a source copy with no .git is fine; it just says so.
  }
  return `${date} ${sha}${dirty}`
}

const stamp = buildStamp()
// Filesystem-safe: the stamp has a space in it, a filename should not.
const slug = stamp.replace(/[^0-9A-Za-z.-]+/g, '-')

console.log(`→ build ${stamp}`)
console.log('→ building the single-file web app')
run('npm', ['run', 'build:single', '-w', '@weekspan/web'], root, { WEEKSPAN_BUILD: stamp })

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

const payload = join(out, `weekspan-${slug}`)
mkdirSync(payload)

cpSync(webSrc, join(payload, 'weekspan.html'))
cpSync(cliSrc, join(payload, 'weekspan-cli.mjs'))

// `init` finds the schema and the AGENTS.md / CLAUDE.md templates by walking
// relative to its own file. esbuild collapses the CLI to a single file that then
// leaves the workspace entirely, so without these sidecars `init` on a fresh
// machine silently produces a bare ledger and a warning.
cpSync(join(root, 'packages/weekspan-core/weekspan.schema.json'), join(payload, 'weekspan.schema.json'))
cpSync(join(root, 'packages/cli/templates'), join(payload, 'templates'), { recursive: true })

cpSync(join(root, 'scripts/install.sh'), join(payload, 'install.sh'))
chmodSync(join(payload, 'install.sh'), 0o755)

writeFileSync(join(payload, 'VERSION'), `${stamp}\n`)

writeFileSync(
  join(payload, 'READ-ME-FIRST.txt'),
  `weekspan — build ${stamp}

INSTALL (or update)
-------------------
From inside this folder:

    ./install.sh

Installs to ~/weekspan. Safe to run over an existing install: it replaces the
app and NEVER touches ~/weekspan/ledger. If an update goes wrong:

    ./install.sh --rollback

Then open ~/weekspan/weekspan.html in Chrome or Edge. Firefox and Safari will
not work — the app reads and writes your ledger through the File System Access
API, which only Chromium browsers implement.

The build stamp is in the app's footer, bottom right. Check it after an update
to confirm you are looking at the new one.

WHAT'S IN HERE
--------------
weekspan.html        the whole app, one file, nothing to install
weekspan-cli.mjs     optional CLI for scripting and AI agents (needs Node 18+)
weekspan.schema.json \\ written beside a new ledger by \`init\`
templates/           /
install.sh           what you just ran
VERSION              ${stamp}

YOUR DATA
---------
Lives in ~/weekspan/ledger/*.weekspan.json — never inside the app, never on a
server. Back that folder up; the app is disposable and re-downloadable.

There is NO SYNC between machines. Two machines editing their own copy of a
ledger will diverge. Keep separate ledgers per machine unless you have set up
sync deliberately.

THE CLI
-------
    node ~/weekspan/weekspan-cli.mjs status --weekspan ~/weekspan/ledger/personal.weekspan.json

Set WEEKSPAN_FILE in your shell profile to skip the --weekspan flag every time.

OFFLINE / LOCKED-DOWN NETWORKS
------------------------------
One external request: IBM Plex from fonts.googleapis.com. If a proxy blocks it
you lose the typeface and nothing else — no app code or data is fetched
remotely.
`,
)

const zipName = `weekspan-${slug}.zip`
let zipped = false
try {
  // -r, not -j: install.sh looks for templates/ as a directory beside itself,
  // and the payload folder is what the user unzips into.
  run('zip', ['-q', '-r', zipName, `weekspan-${slug}`], out)
  zipped = true
} catch {
  console.warn('  (no `zip` on PATH — send the dist-release folder instead)')
}

console.log('')
if (zipped) {
  console.log(`  dist-release/${zipName}   ${kb(join(out, zipName))}`)
} else {
  console.log(`  dist-release/weekspan-${slug}/`)
}
console.log(`  build ${stamp}`)
if (stamp.includes('-dirty')) {
  console.log('  NOTE: built from a dirty tree — commit first if you want this build reproducible.')
}
console.log('')
console.log(`  Next:  send yourself dist-release/${zipName}`)
console.log('         on the other machine: unzip it, cd into the folder, ./install.sh')
