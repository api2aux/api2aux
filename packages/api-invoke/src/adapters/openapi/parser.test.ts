import { describe, it, expect } from 'vitest'
import { normalizeType, parseOpenAPISpec } from './parser'

describe('normalizeType', () => {
  it('returns first non-null type from array', () => {
    expect(normalizeType(['string', 'null'])).toBe('string')
  })

  it('handles null-first ordering', () => {
    expect(normalizeType(['null', 'integer'])).toBe('integer')
  })

  it('falls back when array contains only null', () => {
    expect(normalizeType(['null'])).toBe('string')
  })

  it('falls back for empty array', () => {
    expect(normalizeType([])).toBe('string')
  })

  it('passes through plain strings', () => {
    expect(normalizeType('boolean')).toBe('boolean')
  })

  it('falls back for undefined', () => {
    expect(normalizeType(undefined)).toBe('string')
  })

  it('falls back for null', () => {
    expect(normalizeType(null)).toBe('string')
  })

  it('respects custom fallback', () => {
    expect(normalizeType(undefined, 'object')).toBe('object')
  })

  it('respects custom fallback for null-only array', () => {
    expect(normalizeType(['null'], 'object')).toBe('object')
  })
})

describe('base path overlap stripping', () => {
  it('strips overlapping base path from all operation paths', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: '/api/1' }],
      paths: {
        '/api/1/metastore/schemas': {
          get: { operationId: 'getSchemas', responses: { '200': { description: 'OK' } } },
        },
        '/api/1/metastore/schemas/dataset': {
          get: { operationId: 'getDataset', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const api = await parseOpenAPISpec(spec, { specUrl: 'https://example.com/api/1' })
    expect(api.baseUrl).toBe('https://example.com/api/1')
    expect(api.operations.find(o => o.id === 'getSchemas')!.path).toBe('/metastore/schemas')
    expect(api.operations.find(o => o.id === 'getDataset')!.path).toBe('/metastore/schemas/dataset')
  })

  it('does not strip when paths do not overlap with base path', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: 'https://example.com/v1' }],
      paths: {
        '/users': {
          get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
        },
        '/posts': {
          get: { operationId: 'getPosts', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations.find(o => o.id === 'getUsers')!.path).toBe('/users')
    expect(api.operations.find(o => o.id === 'getPosts')!.path).toBe('/posts')
  })

  it('does not strip when only some paths overlap', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: '/api' }],
      paths: {
        '/api/users': {
          get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
        },
        '/health': {
          get: { operationId: 'health', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const api = await parseOpenAPISpec(spec, { specUrl: 'https://example.com/api' })
    expect(api.operations.find(o => o.id === 'getUsers')!.path).toBe('/api/users')
    expect(api.operations.find(o => o.id === 'health')!.path).toBe('/health')
  })
})

describe('HEAD/OPTIONS parsing', () => {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/health': {
        head: {
          operationId: 'healthCheck',
          responses: { '200': { description: 'OK' } },
        },
      },
      '/cors': {
        options: {
          operationId: 'corsCheck',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  }

  it('parses HEAD operations from spec', async () => {
    const api = await parseOpenAPISpec(spec)
    const headOp = api.operations.find(o => o.id === 'healthCheck')
    expect(headOp).toBeDefined()
    expect(headOp!.method).toBe('HEAD')
    expect(headOp!.path).toBe('/health')
  })

  it('parses OPTIONS operations from spec', async () => {
    const api = await parseOpenAPISpec(spec)
    const optionsOp = api.operations.find(o => o.id === 'corsCheck')
    expect(optionsOp).toBeDefined()
    expect(optionsOp!.method).toBe('OPTIONS')
    expect(optionsOp!.path).toBe('/cors')
  })
})

describe('response schema extraction', () => {
  it('extracts schemas from multiple status codes', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
              '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, created: { type: 'boolean' } } } } } },
              '204': { description: 'No Content' },
              'default': { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
            },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    const op = api.operations[0]

    // Primary schema is from 200
    expect(op.responseSchema).toEqual({ type: 'object', properties: { id: { type: 'string' } } })

    // All schemas mapped by status code
    expect(op.responseSchemas).toBeDefined()
    expect(op.responseSchemas!['200']).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
    expect(op.responseSchemas!['201']).toEqual({ type: 'object', properties: { id: { type: 'string' }, created: { type: 'boolean' } } })
    expect(op.responseSchemas!['204']).toBeUndefined() // No content, no schema
    expect(op.responseSchemas!['default']).toEqual({ type: 'object', properties: { error: { type: 'string' } } })
  })

  it('falls back to 201 as primary when no 200', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } },
            },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    const op = api.operations[0]
    expect(op.responseSchema).toEqual({ type: 'object', properties: { id: { type: 'integer' } } })
    expect(op.responseSchemas).toEqual({ '201': op.responseSchema })
  })

  it('sets responseSchemas to undefined when no responses have schemas', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            operationId: 'health',
            responses: { '204': { description: 'No Content' } },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations[0].responseSchemas).toBeUndefined()
  })

  it('extracts response schemas from Swagger 2.0 specs', async () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Test', version: '1.0.0' },
      host: 'api.example.com',
      basePath: '/v1',
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            parameters: [{ in: 'body', name: 'body', schema: { type: 'object' } }],
            responses: {
              '201': { description: 'Created', schema: { type: 'object', properties: { id: { type: 'integer' } } } },
              'default': { description: 'Error', schema: { type: 'object', properties: { message: { type: 'string' } } } },
            },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    const op = api.operations[0]
    expect(op.responseSchema).toEqual({ type: 'object', properties: { id: { type: 'integer' } } })
    expect(op.responseSchemas!['201']).toEqual({ type: 'object', properties: { id: { type: 'integer' } } })
    expect(op.responseSchemas!['default']).toEqual({ type: 'object', properties: { message: { type: 'string' } } })
  })

  it('does not use default as primary schema', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/ping': {
          get: {
            operationId: 'ping',
            responses: {
              'default': { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
            },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    const op = api.operations[0]
    expect(op.responseSchema).toBeUndefined()
    expect(op.responseSchemas!['default']).toBeDefined()
  })
})

describe('Swagger 2.0 base URL fallback', () => {
  it('uses specUrl origin when host is missing', async () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/status': {
          get: { operationId: 'getStatus', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const api = await parseOpenAPISpec(spec, { specUrl: 'https://open.gsa.gov/api/apidatagov/v1/openapi.yaml' })
    expect(api.baseUrl).toBe('https://open.gsa.gov')
  })

  it('uses specUrl origin with basePath when host is missing', async () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Test', version: '1.0.0' },
      basePath: '/v2',
      paths: {
        '/users': {
          get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const api = await parseOpenAPISpec(spec, { specUrl: 'https://example.com/docs/spec.yaml' })
    expect(api.baseUrl).toBe('https://example.com/v2')
  })
})

describe('operation security extraction', () => {
  it('extracts per-operation security requirements', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      paths: {
        '/secure': {
          get: {
            operationId: 'secureGet',
            security: [{ bearerAuth: [] }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations[0].security).toEqual([['bearerAuth']])
  })

  it('treats security: [] as explicitly no auth', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      security: [{ apiKey: [] }],
      paths: {
        '/public': {
          get: {
            operationId: 'publicGet',
            security: [],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations[0].security).toEqual([])
  })

  it('inherits global security when no per-operation security', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      security: [{ bearerAuth: [] }],
      paths: {
        '/data': {
          get: {
            operationId: 'getData',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations[0].security).toEqual([['bearerAuth']])
  })

  it('returns undefined when no security defined anywhere', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/open': {
          get: {
            operationId: 'openGet',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations[0].security).toBeUndefined()
  })
})

describe('custom fetch resolver (SSRF integration hook)', () => {
  it('forwards options.fetch to SwaggerParser as the HTTP $ref resolver', async () => {
    // A spec containing an external $ref. SwaggerParser must use the custom
    // resolver to read the referenced URL — without it, SwaggerParser falls
    // back to its built-in HTTP resolver, which would bypass any caller-supplied
    // SSRF protection.
    const childSchema = JSON.stringify({
      type: 'object',
      properties: { id: { type: 'string' } },
    })
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/things': {
          get: {
            operationId: 'getThing',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: 'https://fake.example.test/child.json' },
                  },
                },
              },
            },
          },
        },
      },
    }

    const customFetchUrls: string[] = []
    const customFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      customFetchUrls.push(url)
      return new Response(childSchema, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const api = await parseOpenAPISpec(spec, { fetch: customFetch })

    expect(customFetchUrls).toContain('https://fake.example.test/child.json')
    expect(api.operations).toHaveLength(1)
  })

  it('does not break backward compatibility when fetch option is omitted', async () => {
    // Same spec without external $refs — must still parse fine without options.fetch.
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/ping': {
          get: {
            operationId: 'ping',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const api = await parseOpenAPISpec(spec)
    expect(api.operations).toHaveLength(1)
    expect(api.operations[0]?.id).toBe('ping')
  })
})
