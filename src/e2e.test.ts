/**
 * End-to-end tests against real public APIs.
 * These hit the network — run separately from unit tests.
 *
 * Usage: pnpm test:e2e
 */

import { describe, it, expect } from 'vitest'
import { createClient } from './client'
import { withRetry, logging, corsProxy } from './middleware'
import { hasGraphQLErrors, getGraphQLErrors } from './adapters/graphql/errors'
import type { Auth, Enricher } from './core/types'
import { AuthType, ContentType, HeaderName, HttpMethod, ParamLocation, SpecFormat } from './core/types'

const TIMEOUT = 30_000

// ── Spec Parsing ──
// Diverse categories, JSON + YAML, OpenAPI 3.x + Swagger 2.0

const PARSE_SPECS = [
  { name: 'National Weather Service', specUrl: 'https://api.weather.gov/openapi.json', category: 'Government' },
  { name: 'OpenF1', specUrl: 'https://api.openf1.org/openapi.json', category: 'Sports' },
  { name: 'Reqres API', specUrl: 'https://reqres.in/openapi.json', category: 'Utilities' },
  { name: 'HTTPBin (Swagger 2.0)', specUrl: 'http://httpbin.org/spec.json', category: 'Utilities' },
  { name: 'Cleveland Museum of Art', specUrl: 'https://openaccess-api.clevelandart.org/openapi.json', category: 'Art/Culture' },
  { name: 'Postcodes.io (YAML)', specUrl: 'https://postcodes.io/openapi.yaml', category: 'Geolocation' },
  { name: 'Datamuse (YAML)', specUrl: 'https://www.datamuse.com/openapi.yaml', category: 'Education' },
]

describe('e2e: spec parsing', () => {
  for (const api of PARSE_SPECS) {
    it(`parses ${api.name} (${api.category})`, async () => {
      const client = await createClient(api.specUrl)

      expect(client.api.operations.length).toBeGreaterThan(0)
      expect(client.api.baseUrl).toBeTruthy()

      for (const op of client.api.operations) {
        expect(op.id).toBeTruthy()
        expect(op.method).toBeTruthy()
        expect(op.path).toBeTruthy()
      }
    }, TIMEOUT)
  }

  it('handles large spec (ElevenLabs, 250+ operations)', async () => {
    const client = await createClient('https://api.elevenlabs.io/openapi.json')
    expect(client.api.operations.length).toBeGreaterThan(200)
    expect(client.api.baseUrl).toContain('elevenlabs.io')
  }, TIMEOUT)

  it('detects Swagger 2.0 format', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    expect(client.api.specFormat).toBe(SpecFormat.OPENAPI_2)
  }, TIMEOUT)
})

// ── GET Execution ──

describe('e2e: GET execution', () => {
  it('National Weather Service — list alerts', async () => {
    const client = await createClient('https://api.weather.gov/openapi.json')
    const op = client.api.operations.find(
      o => o.method.toLowerCase() === 'get' && o.path === '/alerts',
    )
    expect(op).toBeDefined()

    const result = await client.execute(op!.id)
    expect(result.status).toBe(200)
    expect(result.data).toBeDefined()
  }, TIMEOUT)

  it('HTTPBin — GET /get echoes request', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.url).toContain('httpbin.org/get')
  }, TIMEOUT)

  it('Postcodes.io — lookup postcode (YAML spec)', async () => {
    const client = await createClient('https://postcodes.io/openapi.yaml')
    const lookupOp = client.api.operations.find(
      o => o.method.toLowerCase() === 'get' && o.path.includes('/postcodes/') && o.path.includes('{'),
    )
    expect(lookupOp).toBeDefined()

    const result = await client.execute(lookupOp!.id, { postcode: 'SW1A 1AA' })
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.result.country).toBe('England')
  }, TIMEOUT)
})

// ── HTTP Methods (POST, PUT, PATCH, DELETE) ──

describe('e2e: HTTP methods', () => {
  let httpbin: Awaited<ReturnType<typeof createClient>>

  // Parse spec once, reuse across method tests
  it('parses HTTPBin spec', async () => {
    httpbin = await createClient('http://httpbin.org/spec.json')
    expect(httpbin.api.operations.length).toBeGreaterThan(50)
  }, TIMEOUT)

  it('POST /post with JSON body', async () => {
    const result = await httpbin.execute('post_post', {
      body: { message: 'hello', count: 42 },
    })
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.json).toEqual({ message: 'hello', count: 42 })
    expect(data.headers[HeaderName.CONTENT_TYPE]).toContain(ContentType.JSON)
  }, TIMEOUT)

  it('POST /post with string body', async () => {
    const result = await httpbin.execute('post_post', {
      body: JSON.stringify({ key: 'value' }),
    })
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.json).toEqual({ key: 'value' })
  }, TIMEOUT)

  it('PUT /put with body', async () => {
    const result = await httpbin.execute('put_put', {
      body: { updated: true },
    })
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.json).toEqual({ updated: true })
  }, TIMEOUT)

  it('PATCH /patch with body', async () => {
    const result = await httpbin.execute('patch_patch', {
      body: { field: 'patched' },
    })
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.json).toEqual({ field: 'patched' })
  }, TIMEOUT)

  it('DELETE /delete', async () => {
    const result = await httpbin.execute('delete_delete')
    expect(result.status).toBe(200)
    expect(result.data).toBeDefined()
  }, TIMEOUT)
})

// ── Path & Query Parameters ──

describe('e2e: parameter interpolation', () => {
  let httpbin: Awaited<ReturnType<typeof createClient>>

  it('parses HTTPBin spec', async () => {
    httpbin = await createClient('http://httpbin.org/spec.json')
  }, TIMEOUT)

  it('path param — /status/{codes}', async () => {
    const result = await httpbin.execute('get_status_codes', { codes: '200' })
    expect(result.status).toBe(200)
  }, TIMEOUT)

  it('path param — /base64/{value}', async () => {
    // HTTPBin decodes base64 in the path
    const encoded = btoa('hello world')
    const result = await httpbin.execute('get_base64_value', { value: encoded })
    expect(result.status).toBe(200)
  }, TIMEOUT)

  it('multiple path params — /links/{n}/{offset}', async () => {
    const result = await httpbin.execute('get_links_n_offset', { n: 5, offset: 0 })
    expect(result.status).toBe(200)
  }, TIMEOUT)

  it('query params — /drip', async () => {
    const result = await httpbin.execute('get_drip', {
      duration: 0,
      numbytes: 5,
      code: 200,
      delay: 0,
    })
    expect(result.status).toBe(200)
  }, TIMEOUT)

  it('header param — /bearer with Authorization header', async () => {
    const result = await httpbin.execute('get_bearer', {
      Authorization: 'Bearer test-token-123',
    })
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.authenticated).toBe(true)
    expect(data.token).toBe('test-token-123')
  }, TIMEOUT)
})

// ── Error Handling ──

describe('e2e: error handling', () => {
  it('throws on non-existent spec URL', async () => {
    await expect(
      createClient('https://httpbin.org/status/404/openapi.json'),
    ).rejects.toThrow()
  }, TIMEOUT)

  it('throws on non-200 status from API call', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    await expect(
      client.execute('get_status_codes', { codes: '500' }),
    ).rejects.toThrow()
  }, TIMEOUT)

  it('throws auth error on 401', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    await expect(
      client.execute('get_status_codes', { codes: '401' }),
    ).rejects.toThrow(/auth/i)
  }, TIMEOUT)

  it('throws auth error on 403', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    await expect(
      client.execute('get_status_codes', { codes: '403' }),
    ).rejects.toThrow(/denied|authorization/i)
  }, TIMEOUT)

  it('throws on unknown operation ID', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    await expect(
      client.execute('nonexistent_operation'),
    ).rejects.toThrow(/not found/i)
  }, TIMEOUT)

  it('falls back to raw URL for non-spec URL', async () => {
    const client = await createClient('https://httpbin.org/get')
    // Should create a raw client with a single operation
    expect(client.api.operations.length).toBe(1)
    expect(client.api.operations[0].id).toBe('get_get')
  }, TIMEOUT)
})

// ── Middleware ──

describe('e2e: middleware', () => {
  it('logging middleware does not break requests', async () => {
    const logs: string[] = []
    const client = await createClient('http://httpbin.org/spec.json', {
      middleware: [logging({
        log: (msg: string) => logs.push(msg),
      })],
    })

    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
    expect(logs.length).toBeGreaterThan(0)
    // Should have logged the request
    expect(logs.some(l => l.includes('httpbin.org'))).toBe(true)
  }, TIMEOUT)

  it('retry wrapping fetch handles successful request', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      fetch: withRetry({ maxRetries: 2 }),
    })

    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
  }, TIMEOUT)
})

// ── Response Metadata ──

describe('e2e: response metadata', () => {
  it('returns timing info (elapsedMs)', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    const result = await client.execute('get_get')
    expect(result.elapsedMs).toBeGreaterThan(0)
    expect(result.elapsedMs).toBeLessThan(TIMEOUT)
  }, TIMEOUT)

  it('returns response headers', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    const result = await client.execute('get_get')
    expect(result.headers).toBeDefined()
    expect(result.headers['content-type']).toContain(ContentType.JSON)
  }, TIMEOUT)

  it('returns request metadata', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    const result = await client.execute('get_get')
    expect(result.request.method).toBe(HttpMethod.GET)
    expect(result.request.url).toContain('httpbin.org/get')
  }, TIMEOUT)

  it('handles non-JSON response (text)', async () => {
    const client = await createClient('http://httpbin.org/spec.json')
    const result = await client.execute('get_html')
    expect(result.status).toBe(200)
    expect(typeof result.data).toBe('string')
    expect(result.data as string).toContain('Herman Melville')
  }, TIMEOUT)
})

// ── Authenticated APIs ──
// Parse tests always run (no key needed to fetch/parse spec).
// Execution tests skip unless the corresponding env var is set.

const AUTH_SPECS = [
  {
    name: 'Mistral AI',
    specUrl: 'https://docs.mistral.ai/openapi.yaml',
    category: 'AI/ML',
    expectedAuthType: AuthType.BEARER,
    envVar: 'MISTRAL_API_KEY',
    authFactory: (key: string): Auth => ({ type: AuthType.BEARER, token: key }),
    executionTest: {
      findOp: (ops: any[]) => ops.find(
        (op: any) => op.method.toLowerCase() === 'get' && op.path === '/v1/models',
      ),
      validate: (result: any) => {
        expect(result.status).toBe(200)
        expect(result.data).toBeDefined()
      },
    },
  },
  {
    name: 'ElevenLabs',
    specUrl: 'https://api.elevenlabs.io/openapi.json',
    category: 'AI/ML',
    expectedAuthType: null,
    envVar: 'ELEVENLABS_API_KEY',
    authFactory: (key: string): Auth => ({
      type: AuthType.API_KEY, location: ParamLocation.HEADER, name: 'xi-api-key', value: key,
    }),
    executionTest: {
      findOp: (ops: any[]) => ops.find(
        (op: any) => op.method.toLowerCase() === 'get' && op.path === '/v1/models',
      ),
      validate: (result: any) => {
        expect(result.status).toBe(200)
        expect(result.data).toBeDefined()
      },
    },
  },
]

describe('e2e: authenticated APIs — parsing', () => {
  for (const api of AUTH_SPECS) {
    it(`parses ${api.name} spec and detects auth`, async () => {
      const client = await createClient(api.specUrl)

      expect(client.api.operations.length).toBeGreaterThan(0)
      expect(client.api.baseUrl).toBeTruthy()

      if (api.expectedAuthType) {
        expect(client.api.authSchemes.length).toBeGreaterThan(0)
        expect(client.api.authSchemes[0].authType).toBe(api.expectedAuthType)
      }
    }, TIMEOUT)
  }
})

describe('e2e: authenticated APIs — execution', () => {
  for (const api of AUTH_SPECS) {
    const key = process.env[api.envVar]

    it.skipIf(!key)(
      `${api.name} — execute with ${api.envVar}`,
      async () => {
        const client = await createClient(api.specUrl, {
          auth: api.authFactory(key!),
        })

        const op = api.executionTest.findOp(client.api.operations)
        expect(op).toBeDefined()

        const result = await client.execute(op!.id)
        api.executionTest.validate(result)
      },
      TIMEOUT,
    )
  }

  it('HTTPBin — bearer auth header injection', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      auth: { type: AuthType.BEARER, token: 'my-test-token' },
    })

    const result = await client.execute('get_headers')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.headers.Authorization).toBe('Bearer my-test-token')
  }, TIMEOUT)

  it('HTTPBin — basic auth injection', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      auth: { type: AuthType.BASIC, username: 'user', password: 'pass' },
    })

    const result = await client.execute('get_headers')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    // Basic auth header should be base64 encoded
    expect(data.headers.Authorization).toContain('Basic')
  }, TIMEOUT)

  it('HTTPBin — apiKey in header injection', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      auth: { type: AuthType.API_KEY, location: ParamLocation.HEADER, name: 'X-Custom-Key', value: 'secret-key-123' },
    })

    const result = await client.execute('get_headers')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.headers['X-Custom-Key']).toBe('secret-key-123')
  }, TIMEOUT)

  it('HTTPBin — apiKey in query injection', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      auth: { type: AuthType.API_KEY, location: ParamLocation.QUERY, name: 'api_key', value: 'query-secret-456' },
    })

    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.args.api_key).toBe('query-secret-456')
  }, TIMEOUT)

  it('HTTPBin — oauth2 token injection', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      auth: { type: AuthType.OAUTH2, accessToken: 'oauth-token-789' },
    })

    const result = await client.execute('get_headers')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.headers.Authorization).toBe('Bearer oauth-token-789')
  }, TIMEOUT)
})

// ── Client Lifecycle ──

describe('e2e: client lifecycle', () => {
  it('setAuth() adds auth to subsequent requests', async () => {
    const client = await createClient('http://httpbin.org/spec.json')

    // No auth initially
    const before = await client.execute('get_headers')
    const beforeData = before.data as Record<string, any>
    expect(beforeData.headers.Authorization).toBeUndefined()

    // Set auth
    client.setAuth({ type: AuthType.BEARER, token: 'dynamic-token' })
    const after = await client.execute('get_headers')
    const afterData = after.data as Record<string, any>
    expect(afterData.headers.Authorization).toBe('Bearer dynamic-token')
  }, TIMEOUT)

  it('clearAuth() removes auth from subsequent requests', async () => {
    const client = await createClient('http://httpbin.org/spec.json', {
      auth: { type: AuthType.BEARER, token: 'temp-token' },
    })

    // Auth present
    const withAuth = await client.execute('get_headers')
    const withData = withAuth.data as Record<string, any>
    expect(withData.headers.Authorization).toBe('Bearer temp-token')

    // Clear auth
    client.clearAuth()
    const without = await client.execute('get_headers')
    const withoutData = without.data as Record<string, any>
    expect(withoutData.headers.Authorization).toBeUndefined()
  }, TIMEOUT)
})

// ── Enricher ──

describe('e2e: enricher', () => {
  it('enricher modifies ParsedAPI before client is created', async () => {
    const enricher: Enricher = {
      name: 'test-enricher',
      enrichAPI(api) {
        // Add a prefix to all operation descriptions
        for (const op of api.operations) {
          op.description = `[enriched] ${op.description ?? ''}`
        }
        return api
      },
    }

    const client = await createClient('http://httpbin.org/spec.json', { enricher })
    // All operations should have enriched descriptions
    for (const op of client.api.operations) {
      expect(op.description).toMatch(/^\[enriched\]/)
    }
    // Client still works normally
    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
  }, TIMEOUT)
})

// ── Spec as Object ──

describe('e2e: spec as object', () => {
  it('accepts a pre-fetched spec object', async () => {
    // Fetch the spec manually, then pass the object
    const res = await fetch('http://httpbin.org/spec.json')
    const specObject = await res.json()

    const client = await createClient(specObject)
    expect(client.api.operations.length).toBeGreaterThan(50)

    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
  }, TIMEOUT)
})

// ── GraphQL ──

const GRAPHQL_ENDPOINT = 'https://countries.trevorblades.com/graphql'

describe('e2e: GraphQL introspection & parsing', () => {
  it('introspects and parses a GraphQL endpoint via createClient', async () => {
    const client = await createClient(GRAPHQL_ENDPOINT)

    expect(client.api.specFormat).toBe(SpecFormat.GRAPHQL)
    expect(client.api.operations.length).toBeGreaterThan(0)
    expect(client.api.baseUrl).toContain('countries.trevorblades.com')

    for (const op of client.api.operations) {
      expect(op.id).toBeTruthy()
      expect(op.method).toBe(HttpMethod.POST)
      expect(op.path).toBe('/graphql')
      expect(op.tags.length).toBeGreaterThan(0)
    }
  }, TIMEOUT)

  it('discovers expected query fields (countries, continents, languages)', async () => {
    const client = await createClient(GRAPHQL_ENDPOINT)
    const ids = client.api.operations.map(o => o.id)

    expect(ids).toContain('countries')
    expect(ids).toContain('continents')
    expect(ids).toContain('languages')
  }, TIMEOUT)

  it('query operations have buildBody hook', async () => {
    const client = await createClient(GRAPHQL_ENDPOINT)
    const queryOps = client.api.operations.filter(o => o.tags.includes('query'))

    expect(queryOps.length).toBeGreaterThan(0)
    for (const op of queryOps) {
      expect(op.buildBody).toBeDefined()
    }
  }, TIMEOUT)
})

describe('e2e: GraphQL execution', () => {
  it('executes a query without arguments (continents)', async () => {
    const client = await createClient(GRAPHQL_ENDPOINT)
    const result = await client.execute('continents')

    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.data.continents).toBeDefined()
    expect(data.data.continents.length).toBeGreaterThan(0)
  }, TIMEOUT)

  it('executes a query with arguments (country by code)', async () => {
    const client = await createClient(GRAPHQL_ENDPOINT)
    const result = await client.execute('country', { code: 'BR' })

    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    expect(data.data.country).toBeDefined()
    expect(data.data.country.name).toBe('Brazil')
  }, TIMEOUT)

  it('returns GraphQL-level errors in response body (not HTTP error)', async () => {
    const client = await createClient(GRAPHQL_ENDPOINT)

    // Execute with a deliberately malformed query by overriding body
    const result = await client.execute('country', {
      body: { query: '{ invalid_field_that_does_not_exist }' },
    })

    // GraphQL returns 200 even on errors
    expect(result.status).toBe(200)
    expect(hasGraphQLErrors(result)).toBe(true)
    expect(getGraphQLErrors(result).length).toBeGreaterThan(0)
  }, TIMEOUT)
})

// ── CORS Proxy Middleware ──

describe('e2e: cors proxy middleware', () => {
  it('rewrites URL through custom proxy function', async () => {
    // Use corsProxy with a rewrite that routes through HTTPBin's /anything endpoint
    // /anything echoes the request URL, so we can verify the rewrite happened
    const client = await createClient('http://httpbin.org/spec.json', {
      middleware: [corsProxy({
        rewrite: (url) => `http://httpbin.org/anything?proxied_url=${encodeURIComponent(url)}`,
      })],
    })

    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
    const data = result.data as Record<string, any>
    // /anything echoes the full URL — it should contain our proxied_url param
    expect(data.args.proxied_url).toContain('httpbin.org/get')
  }, TIMEOUT)

  it('shouldProxy predicate controls which URLs are rewritten', async () => {
    let rewriteCalled = false
    const client = await createClient('http://httpbin.org/spec.json', {
      middleware: [corsProxy({
        rewrite: (url) => { rewriteCalled = true; return url },
        shouldProxy: () => false, // never proxy
      })],
    })

    const result = await client.execute('get_get')
    expect(result.status).toBe(200)
    expect(rewriteCalled).toBe(false)
  }, TIMEOUT)
})
