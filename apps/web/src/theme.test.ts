import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyTheme, loadTheme, saveTheme, THEMES, type ThemeChoice } from './theme.js'

/**
 * Minimal fake Storage — never touches real localStorage. Implements the
 * full Storage interface so it type-checks wherever `Storage` is expected.
 */
class FakeStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

/** A storage stand-in whose getItem throws, to exercise the catch path. */
class ThrowingStorage implements Storage {
  get length(): number {
    return 0
  }
  clear(): void {}
  getItem(): string | null {
    throw new Error('storage unavailable')
  }
  key(): string | null {
    return null
  }
  removeItem(): void {}
  setItem(): void {
    throw new Error('storage unavailable')
  }
}

/**
 * A detached, DOM-free stand-in for HTMLElement — just enough surface
 * (attribute get/set/remove) for applyTheme to operate on, so the test never
 * needs a real `document`.
 */
function makeFakeElement(): { attrs: Map<string, string> } & Pick<
  HTMLElement,
  'setAttribute' | 'removeAttribute' | 'getAttribute'
> {
  const attrs = new Map<string, string>()
  return {
    attrs,
    setAttribute(name: string, value: string) {
      attrs.set(name, value)
    },
    removeAttribute(name: string) {
      attrs.delete(name)
    },
    getAttribute(name: string) {
      return attrs.has(name) ? (attrs.get(name) as string) : null
    },
  }
}

function asRoot(el: ReturnType<typeof makeFakeElement>): HTMLElement {
  return el as unknown as HTMLElement
}

describe('applyTheme', () => {
  it('removes data-theme for "system" so the media query takes over', () => {
    const el = makeFakeElement()
    el.attrs.set('data-theme', 'warm')
    applyTheme('system', asRoot(el))
    expect(el.getAttribute('data-theme')).toBeNull()
  })

  it.each<ThemeChoice>(['paper', 'solarized', 'warm'])('sets data-theme="%s" for that choice', (choice) => {
    const el = makeFakeElement()
    applyTheme(choice, asRoot(el))
    expect(el.getAttribute('data-theme')).toBe(choice)
  })

  it('switching back to system after an explicit theme removes the attribute', () => {
    const el = makeFakeElement()
    applyTheme('solarized', asRoot(el))
    expect(el.getAttribute('data-theme')).toBe('solarized')
    applyTheme('system', asRoot(el))
    expect(el.getAttribute('data-theme')).toBeNull()
  })
})

describe('saveTheme / loadTheme', () => {
  it('round-trips a saved choice through the given storage', () => {
    const storage = new FakeStorage()
    saveTheme('warm', storage)
    expect(loadTheme(storage)).toBe('warm')
  })

  it.each<ThemeChoice>(['system', 'paper', 'solarized', 'warm'])('round-trips %s', (choice) => {
    const storage = new FakeStorage()
    saveTheme(choice, storage)
    expect(loadTheme(storage)).toBe(choice)
  })

  it('never writes anything but the given storage (no real localStorage touched)', () => {
    const storage = new FakeStorage()
    saveTheme('paper', storage)
    expect(storage.getItem('weekspan.theme')).toBe('paper')
  })

  it('falls back to "system" when nothing is stored', () => {
    const storage = new FakeStorage()
    expect(loadTheme(storage)).toBe('system')
  })

  it('falls back to "system" for an unrecognized stored value, without throwing', () => {
    const storage = new FakeStorage()
    storage.setItem('weekspan.theme', 'not-a-real-theme')
    expect(() => loadTheme(storage)).not.toThrow()
    expect(loadTheme(storage)).toBe('system')
  })

  it('falls back to "system" when reading storage throws, without throwing', () => {
    const storage = new ThrowingStorage()
    expect(() => loadTheme(storage)).not.toThrow()
    expect(loadTheme(storage)).toBe('system')
  })
})

describe('THEMES', () => {
  it('lists all four choices with labels', () => {
    const ids = THEMES.map((t) => t.id).sort()
    expect(ids).toEqual(['paper', 'solarized', 'system', 'warm'])
  })

  it('uses the handoff labels', () => {
    const byId = Object.fromEntries(THEMES.map((t) => [t.id, t.label]))
    expect(byId['paper']).toBe('Paper')
    expect(byId['solarized']).toBe('Solarized dark')
    expect(byId['warm']).toBe('Warm dark')
    expect(byId['system']).toBe('Match system')
  })
})

describe('tokens.css', () => {
  const cssPath = fileURLToPath(new URL('./styles/tokens.css', import.meta.url))
  const css = readFileSync(cssPath, 'utf-8')

  // The bare `:root {` block only — not `:root:not(...)` (media-query guard)
  // and not `:root[data-theme="..."]` (explicit overrides).
  const bareRootMatch = css.match(/(?:^|\n):root \{([\s\S]*?)\n\}/)

  // Every handoff token name, mapped to its --ws- custom property.
  const tokenVars = [
    '--ws-surface',
    '--ws-panel',
    '--ws-subtle',
    '--ws-ink',
    '--ws-ink-2',
    '--ws-ink-3',
    '--ws-ink-4',
    '--ws-hair',
    '--ws-hair-strong',
    '--ws-done-bg',
    '--ws-done-fg',
    '--ws-due-bg',
    '--ws-due-fg',
    '--ws-today-bg',
    '--ws-today-fg',
    '--ws-active-bg',
    '--ws-active-fg',
    '--ws-weekend-bg',
    '--ws-past-tint',
    '--ws-today-tint',
    '--ws-sel-bg',
    '--ws-sel-ring',
    '--ws-hl-bg',
    '--ws-chip-bg',
    '--ws-link-dot',
    '--ws-bar-a',
    '--ws-bar-b',
    '--ws-bar-c',
    '--ws-done-fg-row',
    '--ws-vac-bg',
  ]

  it('has a bare :root block', () => {
    expect(bareRootMatch).not.toBeNull()
  })

  it.each(tokenVars)('defines %s under bare :root (never only inside a media query)', (varName) => {
    const rootBlock = bareRootMatch?.[1] ?? ''
    expect(rootBlock).toMatch(new RegExp(`${varName}:\\s*\\S`))
  })

  it('also defines the shared geometry tokens under bare :root', () => {
    const rootBlock = bareRootMatch?.[1] ?? ''
    for (const geo of [
      '--ws-day-col',
      '--ws-weekend-col',
      '--ws-weekend-block',
      '--ws-week-block',
      '--ws-item-col',
      '--ws-rail',
      '--ws-row-min-h',
      '--ws-chip-h',
    ]) {
      expect(rootBlock).toMatch(new RegExp(`${geo}:\\s*\\S`))
    }
  })

  it('defines each theme override block (paper, solarized, warm)', () => {
    expect(css).toMatch(/:root\[data-theme="paper"\]\s*\{/)
    expect(css).toMatch(/:root\[data-theme="solarized"\]\s*\{/)
    expect(css).toMatch(/:root\[data-theme="warm"\]\s*\{/)
  })

  it('guards the prefers-color-scheme block against explicit paper/solarized choices', () => {
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*?:root:not\(\[data-theme="paper"\]\):not\(\[data-theme="solarized"\]\)/,
    )
  })
})
