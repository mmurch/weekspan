import { useEffect, useMemo } from 'react'
import { weekOf } from '@weekspan/weekspan-core'
import { Grid } from './grid/Grid.js'
import { buildGrid } from './grid/viewModel.js'
import { demoWeekspan, emptyWeekspan, wrappingWeekspan } from './grid/fixtures.js'
import { applyTheme, loadTheme, type ThemeChoice } from './theme.js'
import { Rail } from './Rail.js'

/**
 * Chunk 1 shell: renders a fixture read-only.
 *
 * `today`, `theme` and `fixture` are readable from the query string so the
 * screenshot harness can pin them. A capture that moved with the real calendar
 * would be useless for comparison against the design.
 */

const FIXTURES = {
  demo: demoWeekspan,
  wrapping: wrappingWeekspan,
  empty: emptyWeekspan,
} as const

type FixtureName = keyof typeof FIXTURES

function isTheme(v: string | null): v is ThemeChoice {
  return v === 'system' || v === 'paper' || v === 'solarized' || v === 'warm'
}

function todayFromClock(): string {
  // Local calendar date — "today" is a local question, even though weekspan-core
  // does its arithmetic in UTC.
  const now = new Date()
  const y = String(now.getFullYear()).padStart(4, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function App(): JSX.Element {
  const params = new URLSearchParams(window.location.search)

  const today = params.get('today') ?? todayFromClock()
  const fixtureName = (params.get('fixture') ?? 'demo') as FixtureName
  const themeParam = params.get('theme')

  useEffect(() => {
    applyTheme(isTheme(themeParam) ? themeParam : loadTheme())
  }, [themeParam])

  const vm = useMemo(() => {
    const build = FIXTURES[fixtureName] ?? demoWeekspan
    return buildGrid(build(today), today)
  }, [fixtureName, today])

  const projectColors = [...new Set(vm.rows.map((r) => r.projectColorToken).filter(Boolean))]

  return (
    <div className="ws-shell">
      <Rail projectColors={projectColors as string[]} />
      <div className="ws-main">
        <TopBar today={today} />
        <div className="ws-scroll">
          <Grid vm={vm} />
        </div>
      </div>
    </div>
  )
}

function TopBar({ today }: { today: string }): JSX.Element {
  const label = new Date(`${today}T00:00:00Z`)
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
    .replace(',', '')
  return (
    <div className="ws-topbar">
      <span className="ws-filepicker">
        personal.weekspan <span className="ws-caret">▾</span>
      </span>
      <span className="ws-seg ws-seg--active">Priority</span>
      <span className="ws-seg">Project</span>
      <span className="ws-filter">/ filter</span>
      <span className="ws-topbar-spacer" />
      <span className="ws-date">{label}</span>
      <span className="ws-week">{weekOf(today)}</span>
    </div>
  )
}
