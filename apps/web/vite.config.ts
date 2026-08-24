import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // The shipped app.
        main: resolve(__dirname, 'index.html'),
        // Standalone harness for scripts/probe-ramp.mjs — renders the bar
        // ramp and ProjectColorPicker in isolation (see ramp-probe.html).
        // Not linked from the app; exists only so `npm run build` produces
        // something scripts/probe-ramp.mjs can serve from dist/.
        rampProbe: resolve(__dirname, 'ramp-probe.html'),
      },
    },
  },
  test: { globals: true, include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
