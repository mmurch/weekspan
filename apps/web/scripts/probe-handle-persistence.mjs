/**
 * Settles the one thing ARCHITECTURE.md ("Deployment" → "Known gaps") flags as
 * UNVERIFIED: does IndexedDB — where a mounted directory's
 * `FileSystemDirectoryHandle` lives (see src/store/handles.ts) — actually
 * persist on a `file://` origin? Binding converted from a single file handle
 * to a directory handle (a file handle has no `getParent()`, so it can't
 * reach sibling files like `archive/<week>.json`); a directory handle is
 * structured-cloneable exactly the same way a file handle is, so this probe
 * still answers the same underlying question and does not need re-deriving.
 *
 * We cannot script the real directory picker: `showDirectoryPicker` throws
 * outside a user gesture, and Playwright has no hook into the native OS file
 * dialog it would pop. So this probes with a plain, structured-cloneable
 * object standing in for a handle — exactly the same substitution
 * FileSystemStore.test.ts and handles.test.ts make for the same reason. The
 * question this settles is narrower but load-bearing: does ANYTHING survive
 * in IndexedDB on file://, across (a) a same-tab reload and (b) a full
 * browser restart. If (b) is no, the app's "remember my folder across
 * sessions" feature quietly can't work over file://, no matter how correct
 * handles.ts is.
 *
 * Two scenarios, because they test different things:
 *
 *   1. SAME-TAB RELOAD — an ephemeral browser context, write a record, reload
 *      the page, read it back. Expected to trivially pass; included as a
 *      sanity baseline, not the interesting question.
 *
 *   2. BROWSER RESTART — a PERSISTENT context (a real on-disk profile
 *      directory), write a record, fully close that context (simulating the
 *      user quitting the browser or the OS reclaiming it), relaunch a new
 *      persistent context against the SAME profile directory, read the
 *      record back. This is what "settled, not assumed" actually requires:
 *      an ephemeral context's storage vanishes on close regardless of what
 *      file:// does, so only a persistent-profile relaunch can distinguish
 *      "IndexedDB persisted" from "the browser profile just didn't go away."
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'

const file = path.resolve('dist-single/weekspan.html')
const url = `file://${file}`

const DB_NAME = 'weekspan-handle-persistence-probe'
const STORE_NAME = 'probe'
const KEY = 'proxy-handle'
// `kind: 'directory'` because binding converted from a file handle to a
// directory handle (see ARCHITECTURE.md "Deployment" → "Known gaps"). The
// mechanism this probes — plain structured-clone persistence in IndexedDB —
// is identical for either handle kind; this field is cosmetic, kept accurate
// so the probe mirrors what's actually stored rather than a stale shape.
const VALUE = { kind: 'directory', name: 'probe-weekspan-folder', probedAt: Date.now() }

/** Runs inside the page. Deliberately hand-rolled rather than importing handles.ts,
 * so this probe exercises the raw IndexedDB contract, not our wrapper around it. */
function writeRecord({ dbName, storeName, key, value }) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(storeName)
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value, key)
      tx.oncomplete = () => {
        db.close()
        resolve(true)
      }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

function readRecord({ dbName, storeName, key }) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      // Fresh DB — nothing was ever written in THIS profile.
      req.result.createObjectStore(storeName)
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve(null)
        return
      }
      const tx = db.transaction(storeName, 'readonly')
      const getReq = tx.objectStore(storeName).get(key)
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result ?? null)
      }
      getReq.onerror = () => reject(getReq.error)
    }
    req.onerror = () => reject(req.error)
  })
}

async function probeSameTabReload() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(url)
    await page.evaluate(writeRecord, { dbName: DB_NAME, storeName: STORE_NAME, key: KEY, value: VALUE })

    await page.reload()
    const back = await page.evaluate(readRecord, { dbName: DB_NAME, storeName: STORE_NAME, key: KEY })
    return back !== null && back.name === VALUE.name
  } finally {
    await browser.close()
  }
}

async function probeBrowserRestart() {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'weekspan-handle-probe-'))
  try {
    // Session 1: write, then fully close the browser (not just the page/tab).
    const ctx1 = await chromium.launchPersistentContext(profileDir, { headless: true })
    try {
      const page1 = await ctx1.newPage()
      await page1.goto(url)
      await page1.evaluate(writeRecord, { dbName: DB_NAME, storeName: STORE_NAME, key: KEY, value: VALUE })
    } finally {
      await ctx1.close()
    }

    // Session 2: brand-new browser process, same on-disk profile directory —
    // this is the actual "quit and reopen the browser tomorrow" scenario.
    const ctx2 = await chromium.launchPersistentContext(profileDir, { headless: true })
    try {
      const page2 = await ctx2.newPage()
      await page2.goto(url)
      const back = await page2.evaluate(readRecord, { dbName: DB_NAME, storeName: STORE_NAME, key: KEY })
      return back !== null && back.name === VALUE.name
    } finally {
      await ctx2.close()
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

console.log(`Probing IndexedDB persistence over file://\n  ${url}\n`)

let reloadOk
let restartOk
let error = null

try {
  reloadOk = await probeSameTabReload()
} catch (err) {
  error = err
  reloadOk = false
}

try {
  restartOk = await probeBrowserRestart()
} catch (err) {
  error = error ?? err
  restartOk = false
}

console.log(`1. Same-tab reload      : ${reloadOk ? 'PERSISTS ✓' : 'DID NOT PERSIST ✗'}`)
console.log(`2. Full browser restart : ${restartOk ? 'PERSISTS ✓' : 'DID NOT PERSIST ✗'}`)

if (error) {
  console.log(`\nAn error occurred during probing (treated as a failure above):`)
  console.log(error)
}

console.log('')
if (restartOk) {
  console.log(
    'RESULT: IndexedDB on file:// survives a full browser restart in headless Chromium. ' +
      'A saved FileSystemDirectoryHandle should be readable next session; the user still has to ' +
      're-grant permission via a click (queryPermission comes back "prompt", not "granted") ' +
      'but does NOT have to re-run the native directory picker.',
  )
} else {
  console.log(
    'RESULT: IndexedDB on file:// did NOT survive a full browser restart in this test. ' +
      'The "remember my folder across sessions" feature cannot rely on this — every session ' +
      'would fall back to asking the user to pick the folder again via FilePicker.tsx. ' +
      'This is a genuine finding, not a bug in handles.ts: the round-trip logic there is ' +
      'exercised and passing in handles.test.ts regardless of what the browser\'s storage ' +
      'lifetime turns out to be.',
  )
}
