/**
 * Catalog routes:
 * - GET /catalog — list pre-deployed public APIs
 * - ALL /catalog/:name — MCP endpoint for a catalog API
 */

import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { AppEnv } from '../index'
import { createWorkerServer } from '../services/server-factory'
import { CATALOG_APIS } from '../data/catalog-apis'
import { CATALOG_SEED_DATA } from '../data/catalog-seed'
import type { TenantConfig, AuthConfig } from '../types'
import { AuthConfigType } from '../types'

const catalog = new Hono<AppEnv>()

// List available catalog APIs
catalog.get('/catalog', (c) => {
  const workerUrl = new URL(c.req.url).origin
  const apis = CATALOG_APIS.map(api => ({
    name: api.name,
    description: api.description,
    category: api.category,
    auth: AuthConfigType.NONE,
    mcpUrl: `${workerUrl}/catalog/${api.name}`,
  }))

  return c.json({ apis })
})

// Seed all catalog APIs into KV (dev convenience)
catalog.post('/catalog/seed', async (c) => {
  const store = c.get('store')
  const now = new Date()
  const sixMonths = new Date(now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000)
  let count = 0

  for (const seed of CATALOG_SEED_DATA) {
    const config: TenantConfig = {
      apiUrl: seed.baseUrl,
      baseUrl: seed.baseUrl,
      name: seed.name,
      authType: AuthConfigType.NONE,
      operations: seed.operations,
      createdAt: now.toISOString(),
      expiresAt: sixMonths.toISOString(),
    }
    await store.put(`catalog:${seed.name}`, config)
    count++
  }

  return c.json({ seeded: count })
})

// MCP endpoint for a catalog API
catalog.all('/catalog/:name', async (c) => {
  const name = c.req.param('name')
  const store = c.get('store')

  // Look up pre-seeded catalog config
  const config = await store.get(`catalog:${name}`)
  if (!config) {
    // Check if it's a known catalog API that hasn't been seeded yet
    const known = CATALOG_APIS.find(a => a.name === name)
    if (known) {
      return c.json({ error: `Catalog API "${name}" exists but has not been seeded yet. Run the seed script.` }, 503)
    }
    return c.json({ error: `Catalog API "${name}" not found` }, 404)
  }

  // Catalog APIs have no auth (all public)
  const auth: AuthConfig = { type: AuthConfigType.NONE }

  const server = createWorkerServer(config, auth)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

export { catalog }
