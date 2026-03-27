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
    // Forwards /api-proxy to a local CORS proxy server (e.g. api2aux-platform on :8787).
    // No effect when VITE_CORS_PROXY_URL is set (requests go directly to that URL instead).
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
