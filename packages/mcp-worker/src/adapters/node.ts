/**
 * Node.js entry point — combined server.
 * Serves MCP worker routes + static app files + CORS proxy.
 */

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createApp } from '../index'
import { MemoryTenantStore } from '../stores/memory-store'
import { apiProxy } from '../routes/api-proxy'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const store = new MemoryTenantStore()
const mcpApp = createApp(store)

const app = new Hono()

// Mount MCP worker routes
app.route('/', mcpApp)

// CORS proxy — uses @api2aux/cors-proxy
app.route('/', apiProxy)

// Serve static app files (built app)
const appDistPath = path.resolve(__dirname, '../../app/dist')
const relativeAppDist = path.relative(process.cwd(), appDistPath)

app.use('/*', serveStatic({ root: relativeAppDist }))

// SPA fallback — serve index.html for all non-file routes
app.use('/*', serveStatic({ root: relativeAppDist, path: 'index.html' }))

const port = parseInt(process.env.PORT || '8787', 10)

console.log(`Server running on http://localhost:${port}`)
serve({ fetch: app.fetch, port })
