/**
 * POST /register — Accept pre-parsed API operations and store as a tenant.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../index'
import type { Operation, AuthConfigType, ParamLocation } from '@api2aux/api-invoke'
import type { TenantConfig } from '../types'
import { validateApiUrl } from '../services/security'

const SIX_MONTHS_SECONDS = 6 * 30 * 24 * 60 * 60 // ~180 days

interface RegisterBody {
  apiUrl: string
  baseUrl: string
  name: string
  authType: AuthConfigType
  authParamName?: string
  authSource?: ParamLocation
  operations: Operation[]
}

const register = new Hono<AppEnv>()

register.post('/register', async (c) => {
  let body: RegisterBody
  try {
    body = await c.req.json<RegisterBody>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate required fields
  if (!body.apiUrl || !body.name || !body.authType || !body.operations) {
    return c.json({ error: 'Missing required fields: apiUrl, name, authType, operations' }, 400)
  }

  if (!Array.isArray(body.operations) || body.operations.length === 0) {
    return c.json({ error: 'operations must be a non-empty array' }, 400)
  }

  // SSRF validation
  const urlCheck = validateApiUrl(body.apiUrl)
  if (!urlCheck.valid) {
    return c.json({ error: urlCheck.reason }, 400)
  }

  // Generate tenant ID
  const tenantId = crypto.randomUUID().replace(/-/g, '').slice(0, 12)

  const now = new Date()
  const expires = new Date(now.getTime() + SIX_MONTHS_SECONDS * 1000)

  const config: TenantConfig = {
    apiUrl: body.apiUrl,
    baseUrl: body.baseUrl || body.apiUrl,
    name: body.name,
    authType: body.authType,
    authParamName: body.authParamName,
    authSource: body.authSource,
    operations: body.operations,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  }

  const store = c.get('store')
  await store.put(`tenant:${tenantId}`, config, SIX_MONTHS_SECONDS)

  const workerUrl = new URL(c.req.url).origin
  return c.json({
    tenantId,
    mcpUrl: `${workerUrl}/t/${tenantId}`,
    expiresAt: config.expiresAt,
  }, 201)
})

// List all deployed tenants
register.get('/tenants', async (c) => {
  const store = c.get('store')
  const keys = await store.list('tenant:')
  const workerUrl = new URL(c.req.url).origin

  const tenants = await Promise.all(
    keys.map(async (key) => {
      const id = key.replace('tenant:', '')
      const config = await store.get(key)
      if (!config) return null
      return {
        tenantId: id,
        name: config.name,
        apiUrl: config.apiUrl,
        mcpUrl: `${workerUrl}/t/${id}`,
        operations: config.operations.length,
        createdAt: config.createdAt,
        expiresAt: config.expiresAt,
      }
    })
  )

  return c.json({ tenants: tenants.filter(Boolean) })
})

// Delete a tenant
register.delete('/tenants/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId')
  const store = c.get('store')

  const config = await store.get(`tenant:${tenantId}`)
  if (!config) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  await store.delete(`tenant:${tenantId}`)
  return c.json({ deleted: tenantId })
})

export { register }
