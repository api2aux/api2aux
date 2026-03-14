/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer',
      // Shims for Node builtins used by @apidevtools/swagger-parser (see src/shims/)
      util: path.resolve(__dirname, './src/shims/util.ts'),
      path: path.resolve(__dirname, './src/shims/path.ts'),
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    // Proxy /api-proxy to mcp-worker (must be running on :8787).
    // Start both with `pnpm dev` from the monorepo root.
    proxy: {
      '/api-proxy': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
