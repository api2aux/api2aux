import { describe, it, expect, vi } from 'vitest'
import { withOAuthRefresh } from './oauth-refresh'

function mockTokenResponse(accessToken: string, refreshToken?: string) {
  return new Response(JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('withOAuthRefresh', () => {
  it('passes through non-401 responses unchanged', async () => {
    const baseFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 })
    )
    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt_old',
    }, baseFetch)

    const response = await fetch('https://api.example.com/data')
    expect(response.status).toBe(200)
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes token and retries on 401', async () => {
    const baseFetch = vi.fn()
      // First call: 401
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // Token refresh call
      .mockResolvedValueOnce(mockTokenResponse('new_access_token'))
      // Retry with new token
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt_valid',
      clientId: 'my-client',
    }, baseFetch)

    const response = await fetch('https://api.example.com/data', {
      headers: { Authorization: 'Bearer old_token' },
    })

    expect(response.status).toBe(200)
    expect(baseFetch).toHaveBeenCalledTimes(3)

    // Verify token endpoint was called correctly
    const tokenCall = baseFetch.mock.calls[1]
    expect(tokenCall[0]).toBe('https://auth.example.com/token')
    expect(tokenCall[1].method).toBe('POST')
    const tokenBody = tokenCall[1].body
    expect(tokenBody).toContain('grant_type=refresh_token')
    expect(tokenBody).toContain('refresh_token=rt_valid')
    expect(tokenBody).toContain('client_id=my-client')

    // Verify retry uses new token
    const retryCall = baseFetch.mock.calls[2]
    const retryHeaders = retryCall[1].headers
    expect(retryHeaders['Authorization']).toBe('Bearer new_access_token')
  })

  it('calls onTokenRefresh callback with new tokens', async () => {
    const onTokenRefresh = vi.fn()
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at', 'new_rt'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt_old',
      onTokenRefresh,
    }, baseFetch)

    await fetch('https://api.example.com/data')

    expect(onTokenRefresh).toHaveBeenCalledWith({
      accessToken: 'new_at',
      refreshToken: 'new_rt',
      expiresIn: 3600,
    })
  })

  it('supports async onTokenRefresh callbacks', async () => {
    const persisted: string[] = []
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
      onTokenRefresh: async (tokens) => {
        await new Promise(r => setTimeout(r, 10))
        persisted.push(tokens.accessToken)
      },
    }, baseFetch)

    await fetch('https://api.example.com/data')
    expect(persisted).toEqual(['new_at'])
  })

  it('returns original 401 when refresh fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // Token refresh fails
      .mockResolvedValueOnce(new Response('invalid_grant', { status: 400, statusText: 'Bad Request' }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt_expired',
    }, baseFetch)

    const response = await fetch('https://api.example.com/data')
    expect(response.status).toBe(401)

    // Verify warning was logged with the full error object
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[api-invoke] OAuth2 token refresh failed'),
      expect.objectContaining({ message: expect.stringContaining('400 Bad Request') }),
    )
    warnSpy.mockRestore()
  })

  it('updates refresh token for subsequent refreshes', async () => {
    const baseFetch = vi.fn()
      // First request: 401
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // First refresh: returns new refresh token
      .mockResolvedValueOnce(mockTokenResponse('at1', 'rt_rotated'))
      // First retry: success
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      // Second request: 401 again
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // Second refresh: should use rotated refresh token
      .mockResolvedValueOnce(mockTokenResponse('at2'))
      // Second retry: success
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt_original',
    }, baseFetch)

    await fetch('https://api.example.com/data')
    await fetch('https://api.example.com/data')

    // Second refresh should use the rotated token
    const secondRefreshBody = baseFetch.mock.calls[4][1].body
    expect(secondRefreshBody).toContain('refresh_token=rt_rotated')
  })

  it('sends scopes when provided', async () => {
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
      scopes: ['read', 'write'],
    }, baseFetch)

    await fetch('https://api.example.com/data')

    const tokenBody = baseFetch.mock.calls[1][1].body
    expect(tokenBody).toContain('scope=read+write')
  })

  it('deduplicates concurrent refresh attempts and calls onTokenRefresh once', async () => {
    let refreshCallCount = 0
    const onTokenRefresh = vi.fn()
    const baseFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === 'https://auth.example.com/token') {
        refreshCallCount++
        return Promise.resolve(mockTokenResponse('new_at'))
      }
      // First two calls return 401, retries return 200
      if (!init?.headers || !(init.headers as Record<string, string>)['Authorization']?.includes('new_at')) {
        return Promise.resolve(new Response('', { status: 401 }))
      }
      return Promise.resolve(new Response('ok', { status: 200 }))
    })

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
      onTokenRefresh,
    }, baseFetch)

    // Fire two requests concurrently — both get 401
    const [r1, r2] = await Promise.all([
      fetch('https://api.example.com/a'),
      fetch('https://api.example.com/b'),
    ])

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // Only one refresh should have occurred
    expect(refreshCallCount).toBe(1)
    // Callback should fire exactly once
    expect(onTokenRefresh).toHaveBeenCalledTimes(1)
  })

  it('retries with correct headers when init is undefined', async () => {
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
    }, baseFetch)

    // Call without init argument
    const response = await fetch('https://api.example.com/data')
    expect(response.status).toBe(200)

    const retryCall = baseFetch.mock.calls[2]
    expect(retryCall[1].headers['Authorization']).toBe('Bearer new_at')
  })

  it('preserves method and body on retry', async () => {
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
    }, baseFetch)

    await fetch('https://api.example.com/data', {
      method: 'POST',
      body: '{"name":"Alice"}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer old' },
    })

    const retryCall = baseFetch.mock.calls[2]
    expect(retryCall[1].method).toBe('POST')
    expect(retryCall[1].body).toBe('{"name":"Alice"}')
    expect(retryCall[1].headers['Content-Type']).toBe('application/json')
  })

  it('still returns response when onTokenRefresh callback throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
      onTokenRefresh: () => { throw new Error('DB write failed') },
    }, baseFetch)

    const response = await fetch('https://api.example.com/data')
    expect(response.status).toBe(200)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[api-invoke] onTokenRefresh callback threw'),
      expect.objectContaining({ message: 'DB write failed' }),
    )
    warnSpy.mockRestore()
  })

  it('replaces existing authorization header regardless of casing', async () => {
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
    }, baseFetch)

    // Use Headers instance with lowercase key (as Headers normalizes)
    const headers = new Headers({ authorization: 'Bearer old_token' })
    await fetch('https://api.example.com/data', { headers })

    const retryCall = baseFetch.mock.calls[2]
    const retryHeaders = retryCall[1].headers as Record<string, string>
    // Should have exactly one Authorization entry, not both 'authorization' and 'Authorization'
    const authKeys = Object.keys(retryHeaders).filter(k => k.toLowerCase() === 'authorization')
    expect(authKeys).toHaveLength(1)
    expect(retryHeaders[authKeys[0]]).toBe('Bearer new_at')
  })

  it('handles array-tuple headers on retry', async () => {
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(mockTokenResponse('new_at'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
    }, baseFetch)

    await fetch('https://api.example.com/data', {
      headers: [['Authorization', 'Bearer old'], ['X-Custom', 'value']],
    })

    const retryCall = baseFetch.mock.calls[2]
    const retryHeaders = retryCall[1].headers as Record<string, string>
    expect(retryHeaders['Authorization']).toBe('Bearer new_at')
    expect(retryHeaders['x-custom']).toBe('value')
  })

  it('returns original 401 for Node.js-style stream bodies', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
    }, baseFetch)

    // Simulate a Node.js Readable-like object (has .pipe method)
    const nodeStream = { pipe: () => {} }
    const response = await fetch('https://api.example.com/upload', {
      method: 'POST',
      body: nodeStream as unknown as BodyInit,
    })

    expect(response.status).toBe(401)
    expect(baseFetch).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('returns original 401 for ReadableStream bodies', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))

    const fetch = withOAuthRefresh({
      tokenUrl: 'https://auth.example.com/token',
      refreshToken: 'rt',
    }, baseFetch)

    const stream = new ReadableStream()
    const response = await fetch('https://api.example.com/upload', {
      method: 'POST',
      body: stream,
    })

    expect(response.status).toBe(401)
    // Should not have attempted refresh
    expect(baseFetch).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('stream body'),
    )
    warnSpy.mockRestore()
  })
})
