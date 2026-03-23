import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['src/e2e.test.ts', 'node_modules'],
  },
})
