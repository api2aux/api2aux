import { describe, it, expect, vi } from 'vitest'
import { createClient, ApiInvokeClient } from './client'
import { defineAPI } from './adapters/manual/builder'
import { ContentType } from './core/types'

function mockFetchResponse(body: string, options: { ok?: boolean; status?: number; contentType?: string } = {}) {
  const { ok = true, status = 200, contentType = 'application/json' } = options
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      statusText: ok ? 'OK' : 'Error',
      headers: { 'content-type': contentType },
    })
  )
}

describe('tryContentDetection', () => {
  it('detects OpenAPI 3 spec by content', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/users': {
          get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } },
        },
      },
    })
    const fetch = mockFetchResponse(spec)
    const client = await createClient('https://api.example.com/v1', { fetch })
    expect(client.operations.length).toBeGreaterThan(0)
    expect(client.operations.some(op => op.id === 'listUsers')).toBe(true)
  })

  it('detects Swagger 2 spec by content', async () => {
    const spec = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Test', version: '1.0' },
      basePath: '/api',
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'OK' } } },
        },
      },
    })
    const fetch = mockFetchResponse(spec)
    const client = await createClient('https://api.example.com/v1', { fetch })
    expect(client.operations.some(op => op.id === 'listItems')).toBe(true)
  })

  it('falls back to raw URL for non-spec JSON', async () => {
    const fetch = mockFetchResponse(JSON.stringify({ data: [1, 2, 3] }))
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    // Raw URL mode produces a single generic operation
    expect(client.operations.length).toBe(1)
  })

  it('falls back to raw URL for JSON null response', async () => {
    const fetch = mockFetchResponse('null')
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })

  it('falls back to raw URL for JSON array response', async () => {
    const fetch = mockFetchResponse('[1, 2, 3]')
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })

  it('falls back to raw URL for JSON primitive response', async () => {
    const fetch = mockFetchResponse('"just a string"')
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })

  it('falls back to raw URL for non-JSON response', async () => {
    const fetch = mockFetchResponse('<html>Not JSON</html>', { contentType: 'text/html' })
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })

  it('falls back to raw URL on network failure', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })

  it('falls back to raw URL on non-OK response', async () => {
    const fetch = mockFetchResponse('Forbidden', { ok: false, status: 403 })
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })

  it('propagates spec parse errors when content is detected as a spec', async () => {
    // Content looks like a spec (has openapi key) but is malformed
    const fetch = mockFetchResponse(JSON.stringify({ openapi: '3.0.0' }))
    await expect(
      createClient('https://api.example.com/v1', { fetch })
    ).rejects.toThrow()
  })

  it('re-throws non-network errors from custom fetch', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Custom fetch config error'))
    await expect(
      createClient('https://api.example.com/v1/users', { fetch })
    ).rejects.toThrow('Custom fetch config error')
  })

  it('falls back on AbortError', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    const client = await createClient('https://api.example.com/v1/users', { fetch })
    expect(client.operations.length).toBe(1)
  })
})

// === executeStream ===

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

describe('ApiInvokeClient.executeStream', () => {
  const api = defineAPI('Test API')
    .baseUrl('https://api.example.com')
    .get('/stream', { id: 'streamEvents' })
    .build()

  it('streams SSE events from a named operation', async () => {
    const fetch = mockSSEFetch('data: hello\n\ndata: world\n\n')
    const client = new ApiInvokeClient(api, { fetch })
    const result = await client.executeStream('streamEvents')

    const events = []
    for await (const event of result.stream) {
      events.push(event.data)
    }
    expect(events).toEqual(['hello', 'world'])
  })

  it('throws on unknown operation ID', async () => {
    const client = new ApiInvokeClient(api)
    await expect(
      client.executeStream('nonexistent')
    ).rejects.toThrow('Operation "nonexistent" not found. Available: streamEvents')
  })

  it('uses per-call auth over client-level auth', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    const client = new ApiInvokeClient(api, {
      fetch,
      auth: { type: 'bearer' as const, token: 'client-token' },
    })
    await client.executeStream('streamEvents', {}, {
      auth: { type: 'bearer' as const, token: 'call-token' },
    })

    const [, init] = fetch.mock.calls[0]
    expect(init.headers['Authorization']).toBe('Bearer call-token')
  })

  it('forwards signal option', async () => {
    const fetch = mockSSEFetch('data: x\n\n')
    const controller = new AbortController()
    const client = new ApiInvokeClient(api, { fetch })
    await client.executeStream('streamEvents', {}, { signal: controller.signal })

    const [, init] = fetch.mock.calls[0]
    expect(init.signal).toBe(controller.signal)
  })
})
