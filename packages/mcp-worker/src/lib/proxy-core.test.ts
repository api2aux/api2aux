import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filterProxyHeaders, handleCorsPreflightResponse, proxyRequest } from './proxy-core'

describe('filterProxyHeaders', () => {
  const targetOrigin = 'https://api.example.com'

  it('strips host, origin, cookie, accept-encoding, and connection', () => {
    const incoming = {
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      cookie: 'session=abc',
      'accept-encoding': 'gzip, deflate, br',
      connection: 'keep-alive',
      accept: 'application/json',
      authorization: 'Bearer tok_123',
    }
    const result = filterProxyHeaders(incoming, targetOrigin)

    expect(result).not.toHaveProperty('host')
    expect(result).not.toHaveProperty('origin')
    expect(result).not.toHaveProperty('cookie')
    expect(result).not.toHaveProperty('accept-encoding')
    expect(result).not.toHaveProperty('connection')
    expect(result).toEqual({
      accept: 'application/json',
      authorization: 'Bearer tok_123',
    })
  })

  it('rewrites referer to target origin', () => {
    const incoming = {
      referer: 'http://localhost:5173/some-page',
      accept: '*/*',
    }
    const result = filterProxyHeaders(incoming, targetOrigin)

    expect(result.referer).toBe('https://api.example.com/')
    expect(result.accept).toBe('*/*')
  })

  it('drops non-string header values', () => {
    const incoming = {
      'x-custom': ['val1', 'val2'] as unknown as string,
      'x-single': 'keep',
      'x-undef': undefined as unknown as string,
    }
    const result = filterProxyHeaders(incoming, targetOrigin)

    expect(result).toEqual({ 'x-single': 'keep' })
  })

  it('returns empty object for no passable headers', () => {
    const incoming = {
      host: 'localhost',
      origin: 'http://localhost',
      cookie: 'x=1',
      'accept-encoding': 'br',
      connection: 'keep-alive',
    }
    const result = filterProxyHeaders(incoming, targetOrigin)

    expect(result).toEqual({})
  })

  it('strips extra platform-specific headers via extraSkip', () => {
    const incoming = {
      accept: 'application/json',
      'cf-ray': '12345',
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '1.2.3.4',
      'x-custom': 'keep',
    }
    const extraSkip = new Set(['cf-ray', 'cf-connecting-ip', 'x-forwarded-for'])
    const result = filterProxyHeaders(incoming, targetOrigin, extraSkip)

    expect(result).toEqual({
      accept: 'application/json',
      'x-custom': 'keep',
    })
  })
})

describe('handleCorsPreflightResponse', () => {
  it('returns 204 with correct CORS headers', () => {
    const response = handleCorsPreflightResponse()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400')
  })
})

describe('proxyRequest', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('proxies a GET request and adds CORS header', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

    const request = new Request('http://localhost:5173/api-proxy/https%3A%2F%2Fapi.example.com%2Fdata', {
      method: 'GET',
      headers: { accept: 'application/json', host: 'localhost:5173' },
    })

    const response = await proxyRequest(request, 'https://api.example.com/data')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json()
    expect(body).toEqual({ ok: true })

    globalThis.fetch = originalFetch
  })

  it('forwards body for POST requests', async () => {
    const mockResponse = new Response('created', { status: 201 })
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

    const request = new Request('http://localhost:5173/api-proxy/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })

    const response = await proxyRequest(request, 'https://api.example.com/items')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(ArrayBuffer),
      }),
    )
    expect(response.status).toBe(201)

    globalThis.fetch = originalFetch
  })

  it('does not forward body for GET requests', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

    const request = new Request('http://localhost:5173/api-proxy/test', {
      method: 'GET',
    })

    await proxyRequest(request, 'https://api.example.com/data')

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(callArgs.body).toBeUndefined()

    globalThis.fetch = originalFetch
  })

  it('strips extra platform headers when provided', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

    const request = new Request('http://localhost:5173/api-proxy/test', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'cf-ray': '12345',
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const extraSkip = new Set(['cf-ray', 'x-forwarded-for'])
    await proxyRequest(request, 'https://api.example.com/data', extraSkip)

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(callArgs.headers).toHaveProperty('accept', 'application/json')
    expect(callArgs.headers).not.toHaveProperty('cf-ray')
    expect(callArgs.headers).not.toHaveProperty('x-forwarded-for')

    globalThis.fetch = originalFetch
  })
})
