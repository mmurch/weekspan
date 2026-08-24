import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Verifies the six-token project bar colour ramp (`--ws-bar-a` .. `--ws-bar-f`)
 * is wired correctly in tokens.css: present under bare `:root` (never only
 * inside a media query — see the cascade-order note at the top of
 * tokens.css), redefined explicitly in every theme, and never repeating a
 * colour within one theme's own ramp.
 *
 * Same parsing approach as the `tokens.css` describe block in `theme.test.ts`
 * — read the real file with `node:fs`, regex out each `:root` block, no DOM
 * or CSS parser involved.
 */

const cssPath = fileURLToPath(new URL('../styles/tokens.css', import.meta.url))
const css = readFileSync(cssPath, 'utf-8')

const BAR_TOKENS = ['--ws-bar-a', '--ws-bar-b', '--ws-bar-c', '--ws-bar-d', '--ws-bar-e', '--ws-bar-f']

const THEMES = ['paper', 'solarized', 'warm'] as const

/** The bare `:root { ... }` block only — not `:root:not(...)` or `:root[data-theme="..."]`. */
function bareRootBlock(): string {
  const match = css.match(/(?:^|\n):root \{([\s\S]*?)\n\}/)
  return match?.[1] ?? ''
}

/** The explicit `:root[data-theme="X"] { ... }` override block for one theme. */
function themeBlock(theme: string): string {
  const match = css.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))
  return match?.[1] ?? ''
}

/** Value assigned to a `--ws-bar-*` custom property within a given block's text. */
function valueOf(block: string, token: string): string | null {
  const match = block.match(new RegExp(`${token}:\\s*([^;]+);`))
  return match?.[1]?.trim() ?? null
}

describe('project bar colour ramp (tokens.css)', () => {
  describe('bare :root', () => {
    const root = bareRootBlock()

    it('has a bare :root block to check', () => {
      expect(root).not.toBe('')
    })

    it.each(BAR_TOKENS)('defines %s under bare :root, not only inside a media query', (token) => {
      expect(root).toMatch(new RegExp(`${token}:\\s*\\S`))
    })
  })

  describe.each(THEMES)('theme "%s"', (theme) => {
    const block = themeBlock(theme)

    it('has an explicit :root[data-theme] block to check', () => {
      expect(block).not.toBe('')
    })

    it.each(BAR_TOKENS)('redefines %s', (token) => {
      expect(block).toMatch(new RegExp(`${token}:\\s*\\S`))
    })

    it('assigns six distinct colour values — no project shares a colour with another', () => {
      const values = BAR_TOKENS.map((token) => valueOf(block, token))
      expect(values).not.toContain(null)
      expect(new Set(values).size).toBe(values.length)
    })
  })
})
