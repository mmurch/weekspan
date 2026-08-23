/**
 * The icon rail — 46px, collapsed by default.
 *
 * Sits OUTSIDE the horizontally scrolling grid, so it stays put when the window
 * grows past four weeks and the grid scrolls sideways.
 */
export function Rail({ projectColors }: { projectColors: string[] }): JSX.Element {
  return (
    <div className="ws-rail">
      <button className="ws-rail-btn ws-rail-btn--dark" title="Expand sidebar" type="button">
        ›
      </button>
      <button className="ws-rail-btn ws-rail-btn--active" title="Grid" type="button">
        ▦
      </button>
      <button className="ws-rail-btn" title="Today" type="button">
        ◷
      </button>
      <button className="ws-rail-btn" title="Integrations" type="button">
        ⇄
      </button>
      <div className="ws-rail-spacer" />
      {projectColors.map((token) => (
        <span
          className="ws-rail-swatch"
          key={token}
          style={{ background: `var(--ws-${token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()})` }}
        />
      ))}
      <span className="ws-rail-sync" title="Synced" />
    </div>
  )
}
