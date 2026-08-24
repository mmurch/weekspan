import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * ONE entry point, deliberately.
 *
 * A second HTML entry was added here for a dev-only ramp harness, and it broke
 * `npm run build:single` — the single-file build needs `inlineDynamicImports`,
 * which rollup rejects outright when there is more than one entry. That build is
 * the primary deployment path (a self-contained file you open from disk), so it
 * must not be collateral damage from a debugging tool. It also shipped the
 * harness's HTML into `dist/`.
 *
 * Probe harnesses build themselves on demand instead — see
 * `scripts/probe-ramp.mjs`, which does its own programmatic vite build the same
 * way `scripts/build-singlefile.mjs` does.
 */
export default defineConfig({
  plugins: [react()],
  test: { globals: true, include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
