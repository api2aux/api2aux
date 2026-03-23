import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { apiProxy } from './api-proxy'

vi.mock('@api2aux/cors-proxy', () => ({
  proxyRequest: vi.fn(),
  handleCorsPreflightResponse: vi.fn(),
}))

import { proxyRequest, handleCorsPreflightResponse } from '@api2aux/cors-proxy'

const mockProxyRequest = vi.mocked(proxyRequest)
const mockHandleCors = vi.mocked(handleCorsPreflightResponse)

const app = new Hono()
app.route('/', apiProxy)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('api-proxy route', () => {
  it('proxies GET to decoded target URL', async () => {
    mockProxyRequest.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    const target = encodeURIComponent('https://api.example.com/users')
    const res = await app.request(`/api-proxy/${target}`)

    expect(res.status).toBe(200)
    expect(mockProxyRequest).toHaveBeenCalledOnce()
    const [req, url] = mockProxyRequest.mock.calls[0]!
    expect(url).toBe('https://api.example.com/users')
    expect(req).toBeInstanceOf(Request)
  })

  it('returns 400 for missing or invalid target URL', async () => {
    const res = await app.request('/api-proxy/not-a-url')

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Missing or invalid target URL')
    expect(mockProxyRequest).not.toHaveBeenCalled()
  })

  it('handles OPTIONS with CORS preflight', async () => {
    mockHandleCors.mockReturnValue(new Response(null, { status: 204 }))

    const res = await app.request('/api-proxy/https%3A%2F%2Fapi.example.com', {
      method: 'OPTIONS',
    })

    expect(res.status).toBe(204)
    expect(mockHandleCors).toHaveBeenCalledOnce()
    expect(mockProxyRequest).not.toHaveBeenCalled()
  })

  it('returns 502 when upstream fetch fails', async () => {
    mockProxyRequest.mockRejectedValue(new Error('ECONNREFUSED'))

    const target = encodeURIComponent('https://api.example.com/down')
    const res = await app.request(`/api-proxy/${target}`)

    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Proxy error: ECONNREFUSED')
  })

  it('forwards POST requests', async () => {
    mockProxyRequest.mockResolvedValue(new Response('created', { status: 201 }))

    const target = encodeURIComponent('https://api.example.com/items')
    const res = await app.request(`/api-proxy/${target}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(201)
    const [req] = mockProxyRequest.mock.calls[0]!
    expect(req.method).toBe('POST')
  })
})
