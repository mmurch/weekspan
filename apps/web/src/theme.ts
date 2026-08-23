/**
 * Theme picker logic (handoff: "Theme picker", `#5d`).
 *
 * Theme choice is per-device and stored OUTSIDE the ledger file — it must
 * never be written to the weekspan file and never appears in the JSON/markdown
 * an agent reads. `localStorage` is the right home for it. `applyTheme` and
 * `loadTheme`/`saveTheme` take their root element / Storage as parameters so
 * tests never touch the real DOM globals or real localStorage.
 */

export type ThemeChoice = 'system' | 'paper' | 'solarized' | 'warm'

const STORAGE_KEY = 'weekspan.theme'

const THEME_CHOICES: ReadonlySet<ThemeChoice> = new Set([
  'system',
  'paper',
  'solarized',
  'warm',
])

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && THEME_CHOICES.has(value as ThemeChoice)
}

/**
 * Applies a theme choice to the root element by setting (or removing) the
 * `data-theme` attribute that `tokens.css` keys off of.
 *
 * `'system'` REMOVES the attribute entirely so the
 * `@media (prefers-color-scheme: dark)` rule in tokens.css takes over and
 * the page follows the OS setting.
 */
export function applyTheme(choice: ThemeChoice, root?: HTMLElement): void {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  if (!el) return

  if (choice === 'system') {
    el.removeAttribute('data-theme')
  } else {
    el.setAttribute('data-theme', choice)
  }
}

/**
 * Reads the stored per-device theme choice. Falls back to `'system'` if
 * nothing is stored, the value is unrecognized, or reading throws (e.g.
 * storage disabled, corrupt value).
 */
export function loadTheme(storage?: Storage): ThemeChoice {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return 'system'

  try {
    const raw = store.getItem(STORAGE_KEY)
    return isThemeChoice(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Persists the per-device theme choice. Never touches the ledger file — this
 * is local-only, per-device state.
 */
export function saveTheme(choice: ThemeChoice, storage?: Storage): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return

  try {
    store.setItem(STORAGE_KEY, choice)
  } catch {
    // Storage unavailable/full — theme choice simply won't persist.
  }
}

export const THEMES: ReadonlyArray<{ id: ThemeChoice; label: string; swatch: string }> = [
  { id: 'paper', label: 'Paper', swatch: '#faf9f6' },
  { id: 'solarized', label: 'Solarized dark', swatch: '#002b36' },
  { id: 'warm', label: 'Warm dark', swatch: '#1c1a17' },
  { id: 'system', label: 'Match system', swatch: 'linear-gradient(135deg, #faf9f6 50%, #1c1a17 50%)' },
]
