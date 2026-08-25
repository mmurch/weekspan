import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PROJECT_COLOR_TOKENS } from '@weekspan/weekspan-core'
import { applyTheme, type ThemeChoice } from '../theme.js'
import { ProjectColorPicker } from './ProjectColorPicker.js'
import '../styles/tokens.css'

/**
 * Standalone visual harness for the six-token bar ramp and the
 * ProjectColorPicker — see ramp-probe.html. Not part of the shipped app.
 * Applies `?theme=` the same way App.tsx does, so scripts/probe-ramp.mjs can
 * drive it exactly like the real app's own theme switching.
 */

const THEME_CHOICES: ReadonlySet<string> = new Set(['paper', 'solarized', 'warm'])
function isTheme(v: string | null): v is ThemeChoice {
  return v !== null && THEME_CHOICES.has(v)
}
const themeParam = new URLSearchParams(window.location.search).get('theme')
applyTheme(isTheme(themeParam) ? themeParam : 'paper')

/** `barA` -> `bar-a`. */
function kebab(token: string): string {
  return token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

const PROJECT_NAMES: Record<string, string> = {
  barA: 'Weymouth ground floor',
  barB: 'Kitchen renovation',
  barC: 'Client onboarding',
  barD: 'Backlog',
  barE: 'Personal',
  barF: 'Q3 planning',
}

function RampProbe(): JSX.Element {
  const [pickerValue, setPickerValue] = useState<string>('barC')
  const [pickerOpen, setPickerOpen] = useState(true)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--ws-surface)',
        color: 'var(--ws-ink)',
        fontFamily: "'IBM Plex Sans', sans-serif",
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
      }}
    >
      <h1 style={{ font: '600 16px/1.3 "IBM Plex Sans", sans-serif', margin: 0 }}>
        Project bar ramp — {document.documentElement.getAttribute('data-theme') ?? 'paper'}
      </h1>

      {/* ---- 1. Large swatches, for judging hue + lightness directly ---- */}
      <section>
        <h2 style={{ font: '500 11px/1 "IBM Plex Mono", monospace', color: 'var(--ws-ink-3)', marginBottom: 10 }}>
          RAW RAMP
        </h2>
        <div style={{ display: 'flex', gap: 16 }}>
          {PROJECT_COLOR_TOKENS.map((token) => (
            <div key={token} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 8,
                  background: `var(--ws-${kebab(token)})`,
                  border: '1px solid var(--ws-hair-strong)',
                }}
              />
              <span style={{ font: '500 11px/1 "IBM Plex Mono", monospace', color: 'var(--ws-ink-2)' }}>
                {token}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- 2. In-context: real 3px bar width, priority view (full opacity) ---- */}
      <section>
        <h2 style={{ font: '500 11px/1 "IBM Plex Mono", monospace', color: 'var(--ws-ink-3)', marginBottom: 10 }}>
          IN CONTEXT — PRIORITY VIEW (full opacity, 3px bar)
        </h2>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--ws-hair)',
            borderRadius: 6,
            overflow: 'hidden',
            width: 420,
          }}
        >
          {PROJECT_COLOR_TOKENS.map((token) => (
            <div
              key={token}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                minHeight: 30,
                borderBottom: '1px solid var(--ws-hair)',
                background: 'var(--ws-panel)',
              }}
            >
              <div style={{ width: 3, background: `var(--ws-${kebab(token)})` }} />
              <div
                style={{
                  padding: '7px 10px',
                  font: '400 12.5px/1.4 "IBM Plex Sans", sans-serif',
                  color: 'var(--ws-ink)',
                }}
              >
                {PROJECT_NAMES[token]}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- 3. In-context: project view (55% opacity, per Grid.css .ws-bar--project-view) ---- */}
      <section>
        <h2 style={{ font: '500 11px/1 "IBM Plex Mono", monospace', color: 'var(--ws-ink-3)', marginBottom: 10 }}>
          IN CONTEXT — PROJECT VIEW (55% opacity, 3px bar)
        </h2>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--ws-hair)',
            borderRadius: 6,
            overflow: 'hidden',
            width: 420,
          }}
        >
          {PROJECT_COLOR_TOKENS.map((token) => (
            <div
              key={token}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                minHeight: 30,
                borderBottom: '1px solid var(--ws-hair)',
                background: 'var(--ws-panel)',
              }}
            >
              <div style={{ width: 3, opacity: 0.55, background: `var(--ws-${kebab(token)})` }} />
              <div
                style={{
                  padding: '7px 10px',
                  font: '400 12.5px/1.4 "IBM Plex Sans", sans-serif',
                  color: 'var(--ws-ink)',
                }}
              >
                {PROJECT_NAMES[token]}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- 4. The actual ProjectColorPicker component ---- */}
      <section>
        <h2 style={{ font: '500 11px/1 "IBM Plex Mono", monospace', color: 'var(--ws-ink-3)', marginBottom: 10 }}>
          PROJECTCOLORPICKER (current = {pickerValue})
        </h2>
        {pickerOpen ? (
          <ProjectColorPicker
            value={pickerValue}
            onChange={(t) => setPickerValue(t ?? 'barA')}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <button type="button" onClick={() => setPickerOpen(true)}>
            reopen
          </button>
        )}
      </section>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RampProbe />
  </StrictMode>,
)
