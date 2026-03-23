import { describe, it, expect, vi } from 'vitest'
import { executeOperation, executeRaw, executeOperationStream, executeRawStream, buildRequest } from './executor'
import type { Operation } from './types'
import { AuthType, ContentType, HeaderName, HttpMethod, ParamLocation } from './types'
import { ErrorKind, API_INVOKE_ERROR_NAME } from './errors'

function mockFetch(status = 200, data: unknown = {}, headers: Record<string, string> = {}) {
  const responseHeaders = new Headers({ 'content-type': ContentType.JSON, ...headers })
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), { status, statusText: 'OK', headers: responseHeaders })
  )
}

function mockSSEFetch(sseText: string, status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText))
      controller.close()
    },
  })
  return vi.fn().mockResolvedValue(
    new Response(body, { status, statusText: 'OK', headers: { 'content-type': ContentType.SSE } })
  )
}

const baseUrl = 'https://api.example.com'

const getOp: Operation = {
  id: 'getUser',
  path: '/users/{id}',
  method: HttpMethod.GET,
  parameters: [
    { name: 'id', in: ParamLocation.PATH, required: true, description: '', schema: { type: 'string' } },
    { name: 'limit', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'number' } },
  ],
  tags: [],
}

const postOp: Operation = {
  id: 'createUser',
  path: '/users',
  method: HttpMethod.POST,
  parameters: [],
  requestBody: {
    required: true,
    contentType: ContentType.JSON,
    schema: {
      type: 'object',
      raw: {},
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['name'],
    },
  },
  tags: [],
}

const formOp: Operation = {
  id: 'createToken',
  path: '/oauth/token',
  method: HttpMethod.POST,
  parameters: [],
  requestBody: {
    required: true,
    contentType: ContentType.FORM_URLENCODED,
    schema: {
      type: 'object',
      raw: {},
      properties: {
        grant_type: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
      },
    },
  },
  tags: [],
}

// === Required param validation ===

describe('required param validation', () => {
  it('throws when required path param is missing', async () => {
    const fetch = mockFetch()
    await expect(
      executeOperation(baseUrl, getOp, {}, { fetch })
    ).rejects.toThrow('Missing required parameter: id for operation "getUser"')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes when required param is provided', async () => {
    const fetch = mockFetch(200, { id: '42', name: 'Alice' })
    const result = await executeOperation(baseUrl, getOp, { id: '42' }, { fetch })
    expect(result.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('lists multiple missing params', async () => {
    const op: Operation = {
      id: 'test',
      path: '/items/{a}/{b}',
      method: HttpMethod.GET,
      parameters: [
        { name: 'a', in: ParamLocation.PATH, required: true, description: '', schema: { type: 'string' } },
        { name: 'b', in: ParamLocation.PATH, required: true, description: '', schema: { type: 'string' } },
      ],
      tags: [],
    }
    await expect(
      executeOperation(baseUrl, op, {}, { fetch: mockFetch() })
    ).rejects.toThrow('Missing required parameters: a, b')
  })
})

// === Body property assembly ===

describe('body property assembly from flat args', () => {
  it('assembles body from flat args when no explicit body key', async () => {
    const fetch = mockFetch()
    await executeOperation(baseUrl, postOp, { name: 'Alice', email: 'alice@example.com' }, { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'Alice', email: 'alice@example.com' })
    expect(init.headers[HeaderName.CONTENT_TYPE]).toBe(ContentType.JSON)
  })

  it('uses explicit body key over flat args', async () => {
    const fetch = mockFetch()
    const explicitBody = { name: 'Bob', extra: true }
    await executeOperation(baseUrl, postOp, { body: explicitBody, name: 'Alice' }, { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'Bob', extra: true })
  })

  it('ignores flat args not in requestBody schema', async () => {
    const fetch = mockFetch()
    await executeOperation(baseUrl, postOp, { name: 'Alice', unknownField: 'ignored' }, { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'Alice' })
  })
})

// === Form-urlencoded body ===

describe('form-urlencoded body support', () => {
  it('serializes body as URLSearchParams for form-urlencoded operations', async () => {
    const fetch = mockFetch()
    await executeOperation(baseUrl, formOp, {
      grant_type: 'client_credentials',
      client_id: 'my-id',
      client_secret: 'my-secret',
    }, { fetch })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toContain('/oauth/token')
    expect(init.headers[HeaderName.CONTENT_TYPE]).toBe(ContentType.FORM_URLENCODED)

    const params = new URLSearchParams(init.body)
    expect(params.get('grant_type')).toBe('client_credentials')
    expect(params.get('client_id')).toBe('my-id')
    expect(params.get('client_secret')).toBe('my-secret')
  })

  it('sends JSON for JSON content type operations', async () => {
    const fetch = mockFetch()
    await executeOperation(baseUrl, postOp, { name: 'Alice' }, { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.CONTENT_TYPE]).toBe(ContentType.JSON)
    expect(JSON.parse(init.body)).toEqual({ name: 'Alice' })
  })
})

// === Multipart/form-data body ===

describe('multipart/form-data body support', () => {
  const multipartOp: Operation = {
    id: 'uploadFile',
    path: '/upload',
    method: HttpMethod.POST,
    parameters: [],
    requestBody: {
      required: true,
      contentType: ContentType.MULTIPART,
      schema: {
        type: 'object',
        raw: {},
        properties: {
          file: { type: 'string', format: 'binary' },
          description: { type: 'string' },
        },
      },
    },
    tags: [],
  }

  it('builds FormData body for multipart operations', () => {
    const blob = new Blob(['file content'], { type: 'text/plain' })
    const req = buildRequest(baseUrl, multipartOp, { file: blob, description: 'test file' })
    expect(req.body).toBeInstanceOf(FormData)
    const fd = req.body as FormData
    expect(fd.get('description')).toBe('test file')
    expect(fd.get('file')).toBeInstanceOf(Blob)
  })

  it('does not set Content-Type header for multipart', () => {
    const blob = new Blob(['data'])
    const req = buildRequest(baseUrl, multipartOp, { file: blob, description: 'x' })
    expect(req.headers[HeaderName.CONTENT_TYPE]).toBeUndefined()
  })

  it('handles ArrayBuffer values as file fields', () => {
    const buffer = new ArrayBuffer(4)
    const req = buildRequest(baseUrl, multipartOp, { file: buffer, description: 'binary' })
    const fd = req.body as FormData
    expect(fd.get('file')).toBeInstanceOf(Blob)
    expect(fd.get('description')).toBe('binary')
  })

  it('handles Uint8Array values as file fields', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const req = buildRequest(baseUrl, multipartOp, { file: bytes, description: 'bytes' })
    const fd = req.body as FormData
    expect(fd.get('file')).toBeInstanceOf(Blob)
  })

  it('skips null and undefined values', () => {
    const req = buildRequest(baseUrl, multipartOp, { file: null, description: undefined })
    const fd = req.body as FormData
    expect(fd.get('file')).toBeNull()
    expect(fd.get('description')).toBeNull()
  })

  it('sends FormData to fetch', async () => {
    const fetch = mockFetch()
    const blob = new Blob(['data'])
    await executeOperation(baseUrl, multipartOp, { file: blob, description: 'test' }, { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(init.body).toBeInstanceOf(FormData)
  })
})

// === Timeout ===

describe('timeout enforcement', () => {
  it('throws timeoutError when request exceeds timeout', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), 5)
      })
    )

    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch, timeoutMs: 1 })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.TIMEOUT,
    })
  })

  it('does not timeout when request completes in time', async () => {
    const fetch = mockFetch(200, { ok: true })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, timeoutMs: 5000 }
    )
    expect(result.status).toBe(200)
  })
})

// === AbortSignal ===

describe('AbortSignal support', () => {
  it('passes signal to fetch', async () => {
    const controller = new AbortController()
    const fetch = mockFetch()
    await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, signal: controller.signal }
    )

    const [, init] = fetch.mock.calls[0]
    expect(init.signal).toBe(controller.signal)
  })
})

// === executeRaw ===

describe('executeRaw', () => {
  it('executes a raw GET request', async () => {
    const fetch = mockFetch(200, { users: [] })
    const result = await executeRaw('https://api.example.com/users', { fetch })
    expect(result.status).toBe(200)
    expect(result.data).toEqual({ users: [] })
  })

  it('passes timeout and signal', async () => {
    const controller = new AbortController()
    const fetch = mockFetch()
    await executeRaw('https://api.example.com/users', {
      fetch,
      timeoutMs: 5000,
      signal: controller.signal,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

// === ExecutionResult ===

describe('ExecutionResult', () => {
  it('includes request metadata', async () => {
    const fetch = mockFetch(200, { id: 1 })
    const result = await executeOperation(baseUrl, getOp, { id: '42' }, { fetch })

    expect(result.request.method).toBe(HttpMethod.GET)
    expect(result.request.url).toContain('/users/42')
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('includes response headers', async () => {
    const fetch = mockFetch(200, {}, { 'x-request-id': 'abc-123' })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.headers['x-request-id']).toBe('abc-123')
  })

  it('includes contentType from response', async () => {
    const fetch = mockFetch(200, { ok: true })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.contentType).toBe(ContentType.JSON)
  })

  it('includes contentType for non-JSON responses', async () => {
    const responseHeaders = new Headers({ 'content-type': 'text/xml' })
    const fetch = vi.fn().mockResolvedValue(
      new Response('<root/>', { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.contentType).toBe('text/xml')
    expect(result.data).toBe('<root/>')
  })
})

// === Accept header ===

describe('Accept header', () => {
  it('defaults to application/json', async () => {
    const fetch = mockFetch()
    await executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.ACCEPT]).toBe(ContentType.JSON)
  })

  it('uses operation responseContentType', async () => {
    const fetch = mockFetch()
    const op: Operation = { ...getOp, parameters: [], responseContentType: ContentType.XML }
    await executeOperation(baseUrl, op, {}, { fetch })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.ACCEPT]).toBe(ContentType.XML)
  })

  it('uses explicit accept option over operation default', async () => {
    const fetch = mockFetch()
    const op: Operation = { ...getOp, parameters: [], responseContentType: ContentType.XML }
    await executeOperation(baseUrl, op, {}, { fetch, accept: ContentType.TEXT })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.ACCEPT]).toBe(ContentType.TEXT)
  })
})

// === +json content type variants ===

describe('+json content type handling', () => {
  it('parses application/vnd.api+json as JSON', async () => {
    const responseHeaders = new Headers({ 'content-type': 'application/vnd.api+json' })
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [1, 2] }), { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.data).toEqual({ data: [1, 2] })
    expect(result.contentType).toBe('application/vnd.api+json')
  })

  it('parses application/hal+json as JSON', async () => {
    const responseHeaders = new Headers({ 'content-type': 'application/hal+json; charset=utf-8' })
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _links: {} }), { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.data).toEqual({ _links: {} })
  })
})

// === No content-type header ===

describe('text/plain content-type handling', () => {
  it('tries JSON parse for text/plain and succeeds with JSON body', async () => {
    const responseHeaders = new Headers({ 'content-type': ContentType.TEXT })
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.data).toEqual({ ok: true })
  })

  it('returns raw text when body is not JSON', async () => {
    const responseHeaders = new Headers({ 'content-type': ContentType.TEXT })
    const fetch = vi.fn().mockResolvedValue(
      new Response('plain text response', { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.data).toBe('plain text response')
  })
})

// === application/xml ===

describe('XML handling', () => {
  it('returns application/xml as text', async () => {
    const responseHeaders = new Headers({ 'content-type': ContentType.XML })
    const fetch = vi.fn().mockResolvedValue(
      new Response('<root><item/></root>', { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.contentType).toBe(ContentType.XML)
    expect(result.data).toBe('<root><item/></root>')
  })

  it('returns +xml variant as text', async () => {
    const responseHeaders = new Headers({ 'content-type': 'application/atom+xml' })
    const fetch = vi.fn().mockResolvedValue(
      new Response('<feed/>', { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.contentType).toBe('application/atom+xml')
    expect(result.data).toBe('<feed/>')
  })
})

// === JSON parse failure with throwOnHttpError: false ===

describe('JSON parse failure fallback', () => {
  it('returns raw text when JSON parse fails and throwOnHttpError is false', async () => {
    const responseHeaders = new Headers({ 'content-type': ContentType.JSON })
    const fetch = vi.fn().mockResolvedValue(
      new Response('not valid json {{{', { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.data).toBe('not valid json {{{')
  })

  it('throws parseError when JSON parse fails and throwOnHttpError is true (default)', async () => {
    const responseHeaders = new Headers({ 'content-type': ContentType.JSON })
    const fetch = vi.fn().mockResolvedValue(
      new Response('not valid json {{{', { status: 200, headers: responseHeaders })
    )
    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    ).rejects.toMatchObject({ kind: ErrorKind.PARSE })
  })
})

// === Binary response ===

describe('binary response handling', () => {
  it('returns ArrayBuffer for binary content types and preserves data', async () => {
    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
    const responseHeaders = new Headers({ 'content-type': 'image/png' })
    const fetch = vi.fn().mockResolvedValue(
      new Response(binaryData, { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.contentType).toBe('image/png')
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result.data as ArrayBuffer)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('returns ArrayBuffer for audio content', async () => {
    const responseHeaders = new Headers({ 'content-type': 'audio/mpeg' })
    const fetch = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(8), { status: 200, headers: responseHeaders })
    )
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    expect(result.data).toBeInstanceOf(ArrayBuffer)
  })
})

// === throwOnHttpError ===

describe('throwOnHttpError', () => {
  it('returns error responses as data when false', async () => {
    const fetch = mockFetch(404, { error: 'not found' })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.status).toBe(404)
    expect(result.data).toEqual({ error: 'not found' })
  })

  it('throws on 401 by default', async () => {
    const fetch = mockFetch(401, { error: 'unauthorized' })
    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    ).rejects.toMatchObject({ kind: ErrorKind.AUTH })
  })

  it('throws auth error with correct kind on 403', async () => {
    const fetch = mockFetch(403, { error: 'forbidden' })
    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    ).rejects.toMatchObject({ kind: ErrorKind.AUTH, status: 403 })
  })

  it('throws rate-limit error on 429', async () => {
    const fetch = mockFetch(429, { error: 'too many requests' })
    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    ).rejects.toMatchObject({ kind: ErrorKind.RATE_LIMIT, retryable: true })
  })
})

// === Response body in errors ===

describe('response body in errors', () => {
  it('includes responseBody in auth errors', async () => {
    const fetch = mockFetch(401, { error: 'invalid_token', message: 'Token expired' })
    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    ).rejects.toMatchObject({
      kind: ErrorKind.AUTH,
      responseBody: { error: 'invalid_token', message: 'Token expired' },
    })
  })

  it('includes responseBody in http errors', async () => {
    const fetch = mockFetch(500, { error: 'internal_error' })
    await expect(
      executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    ).rejects.toMatchObject({
      kind: ErrorKind.HTTP,
      responseBody: { error: 'internal_error' },
    })
  })
})

// === errorKind in non-throwing mode ===

describe('errorKind in non-throwing mode', () => {
  it('sets errorKind to auth for 401', async () => {
    const fetch = mockFetch(401, { error: 'unauthorized' })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.errorKind).toBe(ErrorKind.AUTH)
  })

  it('sets errorKind to auth for 403', async () => {
    const fetch = mockFetch(403, { error: 'forbidden' })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.errorKind).toBe(ErrorKind.AUTH)
  })

  it('sets errorKind to rate-limit for 429', async () => {
    const fetch = mockFetch(429, { error: 'too many requests' })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.errorKind).toBe(ErrorKind.RATE_LIMIT)
  })

  it('sets errorKind to http for 500', async () => {
    const fetch = mockFetch(500, { error: 'server error' })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.errorKind).toBe(ErrorKind.HTTP)
  })

  it('does not set errorKind for 200', async () => {
    const fetch = mockFetch(200, { ok: true })
    const result = await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, throwOnHttpError: false }
    )
    expect(result.errorKind).toBeUndefined()
  })
})

// === Per-call auth override ===

describe('per-call auth override', () => {
  it('uses provided auth', async () => {
    const fetch = mockFetch()
    await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {},
      { fetch, auth: { type: AuthType.BEARER, token: 'call-token' } }
    )
    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.AUTHORIZATION]).toBe('Bearer call-token')
  })

  it('sends no auth header when no auth provided', async () => {
    const fetch = mockFetch()
    await executeOperation(baseUrl, { ...getOp, parameters: [] }, {}, { fetch })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.AUTHORIZATION]).toBeUndefined()
  })
})

// === redirect option ===

describe('redirect option', () => {
  it('passes redirect to fetch', async () => {
    const fetch = mockFetch()
    await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch, redirect: 'manual' }
    )
    const [, init] = fetch.mock.calls[0]
    expect(init.redirect).toBe('manual')
  })

  it('defaults to undefined when not set', async () => {
    const fetch = mockFetch()
    await executeOperation(
      baseUrl, { ...getOp, parameters: [] }, {}, { fetch }
    )
    const [, init] = fetch.mock.calls[0]
    expect(init.redirect).toBeUndefined()
  })
})

// === cookie params + cookie auth combination ===

describe('cookie params combined with cookie auth', () => {
  it('preserves both cookie params and cookie auth in Cookie header', async () => {
    const fetch = mockFetch()
    const op: Operation = {
      id: 'test',
      path: '/data',
      method: HttpMethod.GET,
      parameters: [
        { name: 'session', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string' } },
      ],
      tags: [],
    }
    await executeOperation(baseUrl, op, { session: 'abc123' }, {
      fetch,
      auth: { type: AuthType.COOKIE, name: 'csrf', value: 'tok456' },
    })
    const [, init] = fetch.mock.calls[0]
    const cookie = init.headers[HeaderName.COOKIE]
    expect(cookie).toContain('session')
    expect(cookie).toContain('abc123')
    expect(cookie).toContain('csrf')
    expect(cookie).toContain('tok456')
  })
})

// === buildRequest (dry-run) ===

describe('buildRequest', () => {
  it('builds a GET request without executing', () => {
    const req = buildRequest(baseUrl, getOp, { id: '42', limit: 10 })
    expect(req.method).toBe(HttpMethod.GET)
    expect(req.url).toBe('https://api.example.com/users/42?limit=10')
    expect(req.headers[HeaderName.ACCEPT]).toBe(ContentType.JSON)
    expect(req.body).toBeUndefined()
  })

  it('builds a POST request with body', () => {
    const req = buildRequest(baseUrl, postOp, { body: { name: 'Alice' } })
    expect(req.method).toBe(HttpMethod.POST)
    expect(req.body).toBe('{"name":"Alice"}')
    expect(req.headers[HeaderName.CONTENT_TYPE]).toBe(ContentType.JSON)
  })

  it('injects auth', () => {
    const req = buildRequest(baseUrl, { ...getOp, parameters: [] }, {}, { auth: { type: AuthType.BEARER, token: 'tok' } })
    expect(req.headers[HeaderName.AUTHORIZATION]).toBe('Bearer tok')
  })

  it('validates required parameters', () => {
    expect(() => buildRequest(baseUrl, getOp, {})).toThrow('Missing required parameter')
  })

  it('includes request body in ExecutionResult', async () => {
    const fetch = mockFetch()
    const result = await executeOperation(baseUrl, postOp, { body: { name: 'Alice' } }, { fetch })
    expect(result.request.body).toBe('{"name":"Alice"}')
  })

  it('excludes body for HEAD operations even with requestBody', () => {
    const headOp: Operation = {
      id: 'headResource',
      path: '/resource',
      method: HttpMethod.HEAD,
      parameters: [],
      requestBody: postOp.requestBody,
      tags: [],
    }
    const req = buildRequest(baseUrl, headOp, { name: 'Alice' })
    expect(req.method).toBe(HttpMethod.HEAD)
    expect(req.body).toBeUndefined()
  })

  it('excludes body for OPTIONS operations even with requestBody', () => {
    const optionsOp: Operation = {
      id: 'corsProbe',
      path: '/resource',
      method: HttpMethod.OPTIONS,
      parameters: [],
      requestBody: postOp.requestBody,
      tags: [],
    }
    const req = buildRequest(baseUrl, optionsOp, { name: 'Alice' })
    expect(req.method).toBe(HttpMethod.OPTIONS)
    expect(req.body).toBeUndefined()
  })

  it('throws when multipart body is not an object', () => {
    const multipartOp: Operation = {
      id: 'upload',
      path: '/upload',
      method: HttpMethod.POST,
      parameters: [],
      requestBody: {
        required: true,
        contentType: ContentType.MULTIPART,
        schema: { type: 'object', raw: {}, properties: { file: { type: 'string' } } },
      },
      tags: [],
    }
    expect(() => buildRequest(baseUrl, multipartOp, { body: 'not-an-object' })).toThrow(
      'must be an object'
    )
  })

  it('includes cookie params in headers', () => {
    const op: Operation = {
      id: 'test',
      path: '/data',
      method: HttpMethod.GET,
      parameters: [
        { name: 'session', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string' } },
      ],
      tags: [],
    }
    const req = buildRequest(baseUrl, op, { session: 'abc123' })
    expect(req.headers[HeaderName.COOKIE]).toBe('session=abc123')
  })

  it('uses buildBody hook when set on operation', () => {
    const op: Operation = {
      id: 'graphqlQuery',
      path: '/graphql',
      method: HttpMethod.POST,
      parameters: [],
      requestBody: { required: true, contentType: ContentType.JSON, schema: { type: 'object', raw: {} } },
      tags: [],
      buildBody: (args) => ({ query: 'query { user }', variables: args }),
    }
    const req = buildRequest(baseUrl, op, { id: '123' })
    expect(JSON.parse(req.body as string)).toEqual({ query: 'query { user }', variables: { id: '123' } })
  })

  it('explicit body arg overrides buildBody hook', () => {
    const op: Operation = {
      id: 'graphqlQuery',
      path: '/graphql',
      method: HttpMethod.POST,
      parameters: [],
      requestBody: { required: true, contentType: ContentType.JSON, schema: { type: 'object', raw: {} } },
      tags: [],
      buildBody: () => ({ query: 'should not be used' }),
    }
    const req = buildRequest(baseUrl, op, { body: { custom: true } })
    expect(JSON.parse(req.body as string)).toEqual({ custom: true })
  })

  it('skips buildBody for GET/HEAD/OPTIONS methods', () => {
    const buildBody = vi.fn()
    const op: Operation = {
      id: 'test',
      path: '/data',
      method: HttpMethod.GET,
      parameters: [],
      tags: [],
      buildBody,
    }
    const req = buildRequest(baseUrl, op, { id: '123' })
    expect(buildBody).not.toHaveBeenCalled()
    expect(req.body).toBeUndefined()
  })
})

describe('middleware onError isolation', () => {
  const op: Operation = { id: 'test', path: '/data', method: HttpMethod.GET, parameters: [], tags: [] }

  it('does not let middleware onError mask the original fetch error', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const badMiddleware = {
      name: 'bad',
      onError: () => { throw new Error('middleware bug') },
    }
    await expect(
      executeOperation(baseUrl, op, {}, { fetch, middleware: [badMiddleware] })
    ).rejects.toMatchObject({ name: API_INVOKE_ERROR_NAME, kind: ErrorKind.NETWORK })
  })
})

describe('double parse failure', () => {
  const op: Operation = { id: 'test', path: '/data', method: HttpMethod.GET, parameters: [], tags: [] }

  it('throws parseError when both json and text reads fail', async () => {
    const badResponse = new Response('bad', { status: 200, headers: { 'content-type': ContentType.JSON } })
    // Sabotage both json() and text() on the response
    vi.spyOn(badResponse, 'json').mockRejectedValue(new Error('json failed'))
    const clonedResponse = badResponse.clone()
    vi.spyOn(badResponse, 'clone').mockReturnValue(clonedResponse)
    vi.spyOn(clonedResponse, 'text').mockRejectedValue(new Error('text failed'))
    const fetch = vi.fn().mockResolvedValue(badResponse)

    await expect(
      executeOperation(baseUrl, op, {}, { fetch, throwOnHttpError: false })
    ).rejects.toMatchObject({ name: API_INVOKE_ERROR_NAME, kind: ErrorKind.PARSE })
  })
})

// === Streaming ===

describe('executeOperationStream', () => {
  it('streams SSE events from a successful response', async () => {
    const fetch = mockSSEFetch('data: hello\n\ndata: world\n\n')
    const result = await executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })

    expect(result.status).toBe(200)
    expect(result.contentType).toContain(ContentType.SSE)

    const events = []
    for await (const event of result.stream) {
      events.push(event)
    }
    expect(events).toEqual([{ data: 'hello' }, { data: 'world' }])
  })

  it('sets Accept header to text/event-stream by default', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    await executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.ACCEPT]).toBe(ContentType.SSE)
  })

  it('calls onEvent callback for each event', async () => {
    const fetch = mockSSEFetch('data: a\n\ndata: b\n\n')
    const received: string[] = []
    const result = await executeOperationStream(baseUrl, getOp, { id: '1' }, {
      fetch,
      onEvent: (event) => received.push(event.data),
    })

    for await (const _ of result.stream) { /* consume */ }
    expect(received).toEqual(['a', 'b'])
  })

  it('throws authError on 401', async () => {
    const fetch = mockSSEFetch('', 401)
    await expect(
      executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })
    ).rejects.toMatchObject({ name: API_INVOKE_ERROR_NAME, kind: ErrorKind.AUTH })
  })

  it('throws httpError on 500', async () => {
    const fetch = mockSSEFetch('', 500)
    await expect(
      executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })
    ).rejects.toMatchObject({ name: API_INVOKE_ERROR_NAME, kind: ErrorKind.HTTP })
  })

  it('throws parseError when response body is null', async () => {
    const nullBodyResponse = new Response(null, {
      status: 200,
      headers: { 'content-type': ContentType.SSE },
    })
    // Force body to null
    Object.defineProperty(nullBodyResponse, 'body', { value: null })
    const fetch = vi.fn().mockResolvedValue(nullBodyResponse)

    await expect(
      executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })
    ).rejects.toMatchObject({ name: API_INVOKE_ERROR_NAME, kind: ErrorKind.PARSE })
  })

  it('throws authError on 403', async () => {
    const fetch = mockSSEFetch('', 403)
    await expect(
      executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })
    ).rejects.toMatchObject({ name: API_INVOKE_ERROR_NAME, kind: ErrorKind.AUTH, status: 403 })
  })

  it('parses JSON error body on HTTP error', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad request' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': ContentType.SSE },
      })
    )
    await expect(
      executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.HTTP,
      responseBody: { error: 'bad request' },
    })
  })

  it('wraps onEvent callback errors with context', async () => {
    const fetch = mockSSEFetch('data: a\n\n')
    const result = await executeOperationStream(baseUrl, getOp, { id: '1' }, {
      fetch,
      onEvent: () => { throw new Error('callback bug') },
    })

    await expect(async () => {
      for await (const _ of result.stream) { /* consume */ }
    }).rejects.toThrow('onEvent callback threw')
  })

  it('includes elapsedMs in result', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    const result = await executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('uses explicit accept option over default', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    await executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch, accept: 'text/plain' })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers[HeaderName.ACCEPT]).toBe('text/plain')
  })

  it('includes request metadata in result', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    const result = await executeOperationStream(baseUrl, getOp, { id: '1' }, { fetch })

    expect(result.request.method).toBe(HttpMethod.GET)
    expect(result.request.url).toContain('/users/1')
    expect(result.headers).toBeDefined()
  })
})

describe('executeRawStream', () => {
  it('streams SSE events from a raw URL', async () => {
    const fetch = mockSSEFetch('data: token1\n\ndata: token2\n\ndata: [DONE]\n\n')
    const result = await executeRawStream('https://api.example.com/v1/chat', {
      method: HttpMethod.POST,
      body: JSON.stringify({ prompt: 'hello' }),
      fetch,
    })

    expect(result.status).toBe(200)
    const events = []
    for await (const event of result.stream) {
      events.push(event.data)
    }
    expect(events).toEqual(['token1', 'token2', '[DONE]'])
  })

  it('defaults to POST method', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    await executeRawStream('https://api.example.com/stream', { fetch })

    const [, init] = fetch.mock.calls[0]
    expect(init.method).toBe(HttpMethod.POST)
  })
})
