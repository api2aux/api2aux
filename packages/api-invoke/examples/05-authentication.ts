/// <reference types="node" />
/**
 * 05 — Authentication
 *
 * Shows the full auth lifecycle using HTTPBin: parse spec, try without auth,
 * inject credentials, verify they're sent, and clear them.
 * API: HTTPBin (mirrors requests back — ideal for verifying auth headers without real credentials)
 *
 * Run: npx tsx examples/05-authentication.ts
 */

import { createClient, ApiInvokeError } from 'api-invoke'

const client = await createClient('https://httpbin.org/spec.json')
console.log(`API: ${client.api.title} (${client.operations.length} operations)\n`)

// --- Bearer token ---

console.log('--- Bearer token ---\n')

// Without auth: /bearer returns 401
try {
  await client.execute('get_bearer')
} catch (err) {
  if (err instanceof ApiInvokeError) {
    console.log(`Without auth: ${err.status} — ${err.suggestion}`)
  } else {
    throw err
  }
}

// Set a bearer token and retry
client.setAuth({ type: 'bearer', token: 'my-secret-token' })
const bearer = await client.execute('get_bearer')
const bearerData = bearer.data as any
console.log(`With auth: ${bearer.status} — authenticated: ${bearerData.authenticated}, token: ${bearerData.token}`)

// Clear auth
client.clearAuth()
try {
  await client.execute('get_bearer')
} catch (err) {
  if (err instanceof ApiInvokeError) {
    console.log(`After clearAuth: ${err.status} — token removed\n`)
  } else {
    throw err
  }
}

// --- Basic auth ---

console.log('--- Basic auth ---\n')

client.setAuth({ type: 'basic', username: 'user', password: 'pass' })
const basic = await client.execute('get_headers')
const basicHeaders = (basic.data as any).headers
console.log(`Authorization header: ${basicHeaders.Authorization}`)
client.clearAuth()

// --- API key (header) ---

console.log('\n--- API key (header) ---\n')

client.setAuth({ type: 'apiKey', location: 'header', name: 'X-API-Key', value: 'secret-123' })
const apiKeyResult = await client.execute('get_headers')
const apiKeyHeaders = (apiKeyResult.data as any).headers
console.log(`X-API-Key header: ${apiKeyHeaders['X-Api-Key']}`) // HTTPBin normalises headers to title-case
client.clearAuth()

// --- API key (query) ---

console.log('\n--- API key (query) ---\n')

client.setAuth({ type: 'apiKey', location: 'query', name: 'api_key', value: 'query-secret-456' })
const queryResult = await client.execute('get_get')
const queryArgs = (queryResult.data as any).args
console.log(`api_key query param: ${queryArgs.api_key}`)
client.clearAuth()

// --- OAuth2 ---

console.log('\n--- OAuth2 ---\n')

client.setAuth({ type: 'oauth2', accessToken: 'my-oauth-token' })
const oauth2Result = await client.execute('get_headers')
const oauth2Headers = (oauth2Result.data as any).headers
console.log(`Authorization header: ${oauth2Headers.Authorization}`)
client.clearAuth()

// --- Cookie ---

console.log('\n--- Cookie ---\n')

client.setAuth({ type: 'cookie', name: 'session_id', value: 'abc123' })
const cookieResult = await client.execute('get_headers')
const cookieHeaders = (cookieResult.data as any).headers
console.log(`Cookie header: ${cookieHeaders.Cookie}`)
