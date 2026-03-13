import { Hono } from 'hono'
import type { AppEnv } from '../types'

const health = new Hono<AppEnv>()

health.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'api-catalog' })
})

export { health }
