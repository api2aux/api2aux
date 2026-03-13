/**
 * CRUD + search routes for the API catalog.
 */

import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { apis, apiOperations } from '../db/schema'
import { searchApis, getFacets } from '../services/search'
import type { AppEnv } from '../types'

const apisRouter = new Hono<AppEnv>()

// ── List / search APIs ────────────────────────────────────────────────

apisRouter.get('/api/apis', (c) => {
  const { db } = c.get('deps')
  const params = {
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
  }

  const result = searchApis(db, params)
  return c.json(result)
})

// ── Get facet counts ──────────────────────────────────────────────────

apisRouter.get('/api/apis/facets', (c) => {
  const { db } = c.get('deps')
  const facets = getFacets(db)
  return c.json(facets)
})

// ── Get single API with operations ────────────────────────────────────

apisRouter.get('/api/apis/:id', (c) => {
  const { db } = c.get('deps')
  const id = c.req.param('id')

  const api = db.select().from(apis).where(eq(apis.id, id)).get()
  if (!api) {
    return c.json({ error: 'API not found' }, 404)
  }

  const operations = db
    .select()
    .from(apiOperations)
    .where(eq(apiOperations.apiId, id))
    .all()

  return c.json({ ...api, operations })
})

// ── Create API ────────────────────────────────────────────────────────

apisRouter.post('/api/apis', async (c) => {
  const { db } = c.get('deps')
  const body = await c.req.json()

  if (!body.id || !body.name || !body.category || !body.baseUrl) {
    return c.json({ error: 'Missing required fields: id, name, category, baseUrl' }, 400)
  }

  // Check if already exists
  const existing = db.select().from(apis).where(eq(apis.id, body.id)).get()
  if (existing) {
    return c.json({ error: `API "${body.id}" already exists` }, 409)
  }

  db.insert(apis).values({
    id: body.id,
    name: body.name,
    description: body.description,
    category: body.category,
    subcategory: body.subcategory,
    baseUrl: body.baseUrl,
    documentationUrl: body.documentationUrl,
    openapiSpecUrl: body.openapiSpecUrl,
    authType: body.authType ?? 'none',
    freeTier: body.freeTier,
    rateLimits: body.rateLimits,
    responseFormat: body.responseFormat,
    httpMethods: body.httpMethods,
    status: body.status ?? 'active',
    countryRegion: body.countryRegion,
    pricingUrl: body.pricingUrl,
    corsSupport: body.corsSupport,
    logoUrl: body.logoUrl,
    openapiVersion: body.openapiVersion,
    apiVersion: body.apiVersion,
    contactUrl: body.contactUrl,
    contactEmail: body.contactEmail,
    source: body.source ?? 'manual',
  }).run()

  const created = db.select().from(apis).where(eq(apis.id, body.id)).get()
  return c.json(created, 201)
})

// ── Update API ────────────────────────────────────────────────────────

apisRouter.put('/api/apis/:id', async (c) => {
  const { db } = c.get('deps')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = db.select().from(apis).where(eq(apis.id, id)).get()
  if (!existing) {
    return c.json({ error: 'API not found' }, 404)
  }

  // Remove fields that shouldn't be updated directly
  delete body.id
  delete body.createdAt

  db.update(apis)
    .set({ ...body, updatedAt: sql`(datetime('now'))` })
    .where(eq(apis.id, id))
    .run()

  const updated = db.select().from(apis).where(eq(apis.id, id)).get()
  return c.json(updated)
})

// ── Soft delete API ───────────────────────────────────────────────────

apisRouter.delete('/api/apis/:id', (c) => {
  const { db } = c.get('deps')
  const id = c.req.param('id')

  const existing = db.select().from(apis).where(eq(apis.id, id)).get()
  if (!existing) {
    return c.json({ error: 'API not found' }, 404)
  }

  db.update(apis)
    .set({ deletedAt: sql`(datetime('now'))`, updatedAt: sql`(datetime('now'))` })
    .where(eq(apis.id, id))
    .run()

  return c.json({ deleted: id })
})

export { apisRouter }
