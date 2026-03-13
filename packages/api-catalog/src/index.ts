/**
 * Hono app factory — runtime-agnostic.
 * Entry files (dev.ts, entry-cloudflare.ts, etc.) create dependencies
 * and call createApp() to get the Hono app.
 */

import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { cors } from 'hono/cors'
import type { AppDeps, AppEnv } from './types'
import { health } from './routes/health'
import { apisRouter } from './routes/apis'
import { mcpRouter } from './routes/mcp'
import { syncRouter } from './routes/sync'

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>()

  // CORS — credentials required for auth cookies
  app.use('*', cors({
    origin: deps.auth
      ? (process.env.TRUSTED_ORIGINS || 'http://localhost:3000').split(',')
      : '*',
    allowHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'mcp-protocol-version'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['mcp-session-id'],
    credentials: !!deps.auth,
  }))

  // Inject dependencies into context
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    c.set('user', null)
    c.set('session', null)
    await next()
  })

  // Mount better-auth handler (if configured)
  if (deps.auth) {
    const auth = deps.auth
    app.on(['POST', 'GET'], '/api/auth/*', (c) => {
      return auth.handler(c.req.raw)
    })
  }

  // Mount routes
  app.route('/', health)
  app.route('/', apisRouter)
  app.route('/', mcpRouter)
  app.route('/', syncRouter)

  // OpenAPI spec endpoint
  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'API Catalog',
      version: '0.1.0',
      description: 'CRUD and faceted search for the api2aux API catalog.',
    },
    servers: [{ url: '/' }],
    security: [],
  })

  // Scalar API docs UI
  app.get('/docs', Scalar({ url: '/api/openapi.json' }))

  return app
}
