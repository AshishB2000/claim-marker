import { defineConfig } from 'vitest/config'

// separate from vite.config.ts: the tests are pure functions and need no plugins
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
