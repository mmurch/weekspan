import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describeTheme, moveIndex } from './ThemePicker.js'
import { THEMES, type ThemeChoice } from '../theme.js'

/**
 * This test env has no jsdom (see vite.config.ts), so `ThemePicker.tsx`
 * itself is not mounted here. What's tested instead is the pure logic
 * extracted out of it: `describeTheme` (resolving a theme id to its label +
 * swatch) and `moveIndex` (the roving-focus arrow-key step). Everything else
 * in the component is either JSX wiring or DOM-effect glue with nothing pure
 * left to assert once those two are covered.
 */

describe('describeTheme', () => {
  it.each<ThemeChoice>(['paper', 'solarized', 'warm', 'system'])(
    'resolves %s to its THEMES label and swatch',
    (id) => {
      const expected = THEMES.find((t) => t.id === id)!
      expect(describeTheme(id)).toEqual({ label: expected.label, swatch: expected.swatch })
    },
  )

  it('gives "system" a split light/dark swatch, distinct from the three solid swatches', () => {
    const solid = describeTheme('paper').swatch
    const split = describeTheme('system').swatch
    expect(split).toContain('linear-gradient')
    expect(solid).not.toContain('linear-gradient')
  })

  it('falls back to THEMES[0] (Paper) for an id THEMES does not recognize, without throwing', () => {
    expect(() => describeTheme('not-a-real-theme' as ThemeChoice)).not.toThrow()
    expect(describeTheme('not-a-real-theme' as ThemeChoice)).toEqual({
      label: THEMES[0]!.label,
      swatch: THEMES[0]!.swatch,
    })
  })
})

describe('moveIndex', () => {
  it.each(['ArrowDown', 'ArrowRight'] as const)('%s advances by one', (key) => {
    expect(moveIndex(0, key, 4)).toBe(1)
    expect(moveIndex(2, key, 4)).toBe(3)
  })

  it.each(['ArrowUp', 'ArrowLeft'] as const)('%s retreats by one', (key) => {
    expect(moveIndex(2, key, 4)).toBe(1)
    expect(moveIndex(1, key, 4)).toBe(0)
  })

  it.each(['ArrowDown', 'ArrowRight'] as const)('%s wraps from the last row to the first', (key) => {
    expect(moveIndex(3, key, 4)).toBe(0)
  })

  it.each(['ArrowUp', 'ArrowLeft'] as const)('%s wraps from the first row to the last', (key) => {
    expect(moveIndex(0, key, 4)).toBe(3)
  })

  it('leaves the index unchanged for a key it does not handle', () => {
    expect(moveIndex(1, 'Enter', 4)).toBe(1)
    expect(moveIndex(1, 'a', 4)).toBe(1)
  })
})

describe('tokens.css', () => {
  const cssPath = fileURLToPath(new URL('../styles/tokens.css', import.meta.url))
  const tokensCss = readFileSync(cssPath, 'utf-8')

  const pickerCssPath = fileURLToPath(new URL('./ThemePicker.css', import.meta.url))
  const pickerCss = readFileSync(pickerCssPath, 'utf-8')

  // Every `var(--ws-...)` reference ThemePicker.css makes.
  const referenced = [...pickerCss.matchAll(/var\((--ws-[a-z0-9-]+)/g)].map((m) => m[1])

  it('references at least one --ws- custom property', () => {
    expect(referenced.length).toBeGreaterThan(0)
  })

  it.each([...new Set(referenced)])('tokens.css defines %s (bare :root, never only inside a media query)', (varName) => {
    const bareRootMatch = tokensCss.match(/(?:^|\n):root \{([\s\S]*?)\n\}/)
    const rootBlock = bareRootMatch?.[1] ?? ''
    expect(rootBlock).toMatch(new RegExp(`${varName}:\\s*\\S`))
  })
})
