// Must run before importing handles.ts: it installs `indexedDB`/`IDBKeyRange`
// as globals, which is what a real browser provides and Node does not.
// fake-indexeddb is a from-scratch reimplementation of the spec, not a mock —
// it's what lets save/load/list/forget be tested for real instead of stubbed.
import 'fake-indexeddb/auto'

import { ensurePermission, forgetHandle, listHandles, loadHandle, saveHandle } from './handles.js'

/**
 * A `FileSystemDirectoryHandle` is structured-cloneable in a real browser
 * because the browser special-cases it, the same way it special-cases
 * `File`/`Blob`/`FileSystemFileHandle`. fake-indexeddb runs in Node with no
 * such special case, so — exactly as the task's probe script does for the
 * browser side — a PLAIN, structured-clone-friendly object stands in for a
 * real handle here. It has no methods, because functions are not
 * structured-cloneable by the generic algorithm fake-indexeddb implements;
 * that's fine, since save/load/list/forget only ever look at `.name`, never
 * call the handle.
 */
function fakeDirHandle(name: string): FileSystemDirectoryHandle {
  return { kind: 'directory', name } as unknown as FileSystemDirectoryHandle
}

describe('handles — save/load/forget round-trip', () => {
  it('loadHandle returns null for a key that was never saved', async () => {
    expect(await loadHandle('nonexistent')).toBeNull()
  })

  it('saves and loads a handle back out', async () => {
    const handle = fakeDirHandle('personal-weekspan')
    await saveHandle('personal', handle)

    const loaded = await loadHandle('personal')
    expect(loaded).not.toBeNull()
    expect(loaded?.name).toBe('personal-weekspan')
  })

  it('overwrites an existing key rather than erroring', async () => {
    await saveHandle('work', fakeDirHandle('work-v1'))
    await saveHandle('work', fakeDirHandle('work-v2'))

    expect((await loadHandle('work'))?.name).toBe('work-v2')
  })

  it('forgetHandle removes it — a subsequent load returns null', async () => {
    await saveHandle('temp', fakeDirHandle('temp'))
    expect(await loadHandle('temp')).not.toBeNull()

    await forgetHandle('temp')
    expect(await loadHandle('temp')).toBeNull()
  })

  it('forgetHandle on an already-absent key does not throw', async () => {
    await expect(forgetHandle('never-existed')).resolves.toBeUndefined()
  })
})

describe('handles — listHandles', () => {
  it('lists every saved handle as {key, name}', async () => {
    await saveHandle('a', fakeDirHandle('folder-a'))
    await saveHandle('b', fakeDirHandle('folder-b'))

    const list = await listHandles()
    const byKey = Object.fromEntries(list.map((h) => [h.key, h.name]))
    expect(byKey.a).toBe('folder-a')
    expect(byKey.b).toBe('folder-b')
  })

  it('reflects a forgotten handle disappearing from the list', async () => {
    await saveHandle('gone', fakeDirHandle('gone'))
    await forgetHandle('gone')

    const list = await listHandles()
    expect(list.some((h) => h.key === 'gone')).toBe(false)
  })

  it('never lists a key that was forgotten before it was ever saved', async () => {
    await forgetHandle('list-never-saved')
    const list = await listHandles()
    expect(list.some((h) => h.key === 'list-never-saved')).toBe(false)
  })
})

describe('ensurePermission', () => {
  it('returns true without ever calling requestPermission when already granted', async () => {
    let requestCalls = 0
    const handle = {
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => {
        requestCalls++
        return 'granted' as PermissionState
      },
    } as unknown as FileSystemHandle

    expect(await ensurePermission(handle)).toBe(true)
    expect(requestCalls).toBe(0) // queryPermission alone was enough — no prompt needed
  })

  it('requests permission when not already granted, and reports the outcome', async () => {
    const handle = {
      queryPermission: async () => 'prompt' as PermissionState,
      requestPermission: async () => 'granted' as PermissionState,
    } as unknown as FileSystemHandle

    expect(await ensurePermission(handle, 'readwrite')).toBe(true)
  })

  it('returns false when the user denies the request, rather than throwing', async () => {
    const handle = {
      queryPermission: async () => 'prompt' as PermissionState,
      requestPermission: async () => 'denied' as PermissionState,
    } as unknown as FileSystemHandle

    expect(await ensurePermission(handle)).toBe(false)
  })

  it('works identically for a file handle — the check is handle-kind-agnostic', async () => {
    const handle = {
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => 'granted' as PermissionState,
    } as unknown as FileSystemFileHandle

    expect(await ensurePermission(handle)).toBe(true)
  })
})
