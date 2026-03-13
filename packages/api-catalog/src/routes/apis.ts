/**
 * HTTP routes for the API catalog.
 * Thin layer: parse request → call service → return response.
 */

import { Hono } from 'hono'
import { ApiRepository } from '../repositories/api-repository'
import { ApiService } from '../services/api-service'
import type { AppEnv } from '../types'

const apisRouter = new Hono<AppEnv>()

function getService(c: { get(key: 'deps'): { db: import('../types').Database } }) {
  const { db } = c.get('deps')
  return new ApiService(new ApiRepository(db))
}

// ── List / search APIs ────────────────────────────────────────────────

apisRouter.get('/api/apis', (c) => {
  const service = getService(c)
  const result = service.search({
    q: c.req.query('q'),
    category: c.req.query('category'),
    subcategory: c.req.query('subcategory'),
    authType: c.req.query('authType'),
    freeTier: c.req.query('freeTier'),
    corsSupport: c.req.query('corsSupport'),
    hasSpec: c.req.query('hasSpec'),
    status: c.req.query('status'),
    page: c.req.query('page') ? Number(c.req.query('page')) : undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  })
  return c.json(result)
})

// ── Get facet counts ──────────────────────────────────────────────────

apisRouter.get('/api/apis/facets', (c) => {
  return c.json(getService(c).facets())
})

// ── Get single API with operations ────────────────────────────────────

apisRouter.get('/api/apis/:id', (c) => {
  const result = getService(c).getById(c.req.param('id'))
  if (!result) return c.json({ error: 'API not found' }, 404)
  return c.json(result)
})

// ── Create API ────────────────────────────────────────────────────────

apisRouter.post('/api/apis', async (c) => {
  const body = await c.req.json()

  if (!body.id || !body.name || !body.category || !body.baseUrl) {
    return c.json({ error: 'Missing required fields: id, name, category, baseUrl' }, 400)
  }

  const result = getService(c).create(body)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  return c.json(result.data, result.status)
})

// ── Update API ────────────────────────────────────────────────────────

apisRouter.put('/api/apis/:id', async (c) => {
  const body = await c.req.json()
  const updated = getService(c).update(c.req.param('id'), body)
  if (!updated) return c.json({ error: 'API not found' }, 404)
  return c.json(updated)
})

// ── Soft delete API ───────────────────────────────────────────────────

apisRouter.delete('/api/apis/:id', (c) => {
  const id = c.req.param('id')
  const deleted = getService(c).delete(id)
  if (!deleted) return c.json({ error: 'API not found' }, 404)
  return c.json({ deleted: id })
})

export { apisRouter }
