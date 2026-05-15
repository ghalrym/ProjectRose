import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    // Renderer tests need a DOM; main/preload tests stay on node.
    environmentMatchGlobs: [
      ['src/renderer/**', 'jsdom']
    ],
    // Main-process tests that transitively import `electron` (e.g. through
    // settingsHandlers / chatSession) need the binary to resolve, which
    // is unavailable under vitest. setup-electron-mock.ts swaps the
    // module out for a minimal stub before any test file loads.
    setupFiles: ['./src/test/setup-electron-mock.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/__tests__/**', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
