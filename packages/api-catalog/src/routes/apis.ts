/**
 * HTTP routes for the API catalog.
 * Thin layer: parse request → call service → return response.
 *
 * Read operations (GET) are public.
 * Write operations (POST, PUT, DELETE) require authentication.
 *
 * Uses @hono/zod-openapi for automatic OpenAPI spec generation.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { ApiRepository } from '../repositories/api-repository'
import { ApiService } from '../services/api-service'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'
import {
  ApiSchema, ApiDetailSchema, SearchResultSchema, SearchQuerySchema,
  FacetsSchema, CreateApiSchema, UpdateApiSchema,
  ErrorSchema, DeletedSchema, IdParamSchema,
} from '../schemas'

const apisRouter = new OpenAPIHono<AppEnv>()

function getService(c: { get(key: 'deps'): { db: import('../types').Database } }) {
  const { db } = c.get('deps')
  return new ApiService(new ApiRepository(db))
}

// ── Public read routes ────────────────────────────────────────────────

const listRoute = createRoute({
  method: 'get',
  path: '/api/apis',
  tags: ['APIs'],
  summary: 'Search and list APIs',
  description: 'Search the catalog with text search and faceted filters. Returns paginated results.',
  request: { query: SearchQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: SearchResultSchema } }, description: 'Paginated list of APIs' },
  },
})

apisRouter.openapi(listRoute, (c) => {
  const service = getService(c)
  const q = c.req.valid('query')
  const result = service.search({
    ...q,
    page: q.page ? Number(q.page) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  })
  return c.json(result, 200)
})

const facetsRoute = createRoute({
  method: 'get',
  path: '/api/apis/facets',
  tags: ['APIs'],
  summary: 'Get facet counts',
  description: 'Returns category, auth type, free tier, and status distributions for filtering.',
  responses: {
    200: { content: { 'application/json': { schema: FacetsSchema } }, description: 'Facet counts' },
  },
})

apisRouter.openapi(facetsRoute, (c) => {
  return c.json(getService(c).facets(), 200)
})

const getByIdRoute = createRoute({
  method: 'get',
  path: '/api/apis/{id}',
  tags: ['APIs'],
  summary: 'Get API by ID',
  description: 'Returns a single API with its parsed operations (if available).',
  request: { params: IdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: ApiDetailSchema } }, description: 'API details with operations' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'API not found' },
  },
})

apisRouter.openapi(getByIdRoute, (c) => {
  const { id } = c.req.valid('param')
  const result = getService(c).getById(id)
  if (!result) return c.json({ error: 'API not found' }, 404)
  return c.json(result, 200)
})

// ── Protected write routes ────────────────────────────────────────────

const createApiRoute = createRoute({
  method: 'post',
  path: '/api/apis',
  tags: ['APIs'],
  summary: 'Create a new API',
  description: 'Add a new API to the catalog. Requires authentication.',
  middleware: [requireAuth],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateApiSchema } }, required: true },
  },
  responses: {
    201: { content: { 'application/json': { schema: ApiSchema } }, description: 'API created' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Missing required fields' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'API already exists' },
  },
})

apisRouter.openapi(createApiRoute, (c) => {
  const body = c.req.valid('json')
  const result = getService(c).create(body)
  if (result.status === 409) return c.json({ error: result.error }, 409)
  return c.json(result.data, 201)
})

const updateRoute = createRoute({
  method: 'put',
  path: '/api/apis/{id}',
  tags: ['APIs'],
  summary: 'Update an API',
  description: 'Update an existing API\'s metadata. Requires authentication.',
  middleware: [requireAuth],
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateApiSchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: ApiSchema } }, description: 'API updated' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'API not found' },
  },
})

apisRouter.openapi(updateRoute, (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const updated = getService(c).update(id, body)
  if (!updated) return c.json({ error: 'API not found' }, 404)
  return c.json(updated, 200)
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/api/apis/{id}',
  tags: ['APIs'],
  summary: 'Delete an API',
  description: 'Soft-delete an API (sets deleted_at timestamp). Requires authentication.',
  middleware: [requireAuth],
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: DeletedSchema } }, description: 'API deleted' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'API not found' },
  },
})

apisRouter.openapi(deleteRoute, (c) => {
  const { id } = c.req.valid('param')
  const deleted = getService(c).delete(id)
  if (!deleted) return c.json({ error: 'API not found' }, 404)
  return c.json({ deleted: id }, 200)
})

export { apisRouter }
