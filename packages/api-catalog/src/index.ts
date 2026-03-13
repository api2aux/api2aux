/**
 * Hono app factory — runtime-agnostic.
 * Entry files (dev.ts, entry-cloudflare.ts, etc.) create dependencies
 * and call createApp() to get the Hono app.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppDeps, AppEnv } from './types'
import { health } from './routes/health'
import { apisRouter } from './routes/apis'

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()

  // CORS
  app.use('*', cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }))

  // Inject dependencies into context
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })

  // Mount routes
  app.route('/', health)
  app.route('/', apisRouter)

  return app
}
