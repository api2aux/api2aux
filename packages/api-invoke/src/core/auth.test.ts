import { describe, it, expect, vi } from 'vitest'
import { injectAuth, maskAuth, refreshOAuth2Token } from './auth'
import { AuthType, HeaderName, ParamLocation } from './types'
import { API_INVOKE_ERROR_NAME, ErrorKind } from './errors'

describe('injectAuth', () => {
  it('injects bearer token', () => {
    const result = injectAuth('https://api.example.com', {}, { type: AuthType.BEARER, token: 'abc123' })
    expect(result.headers[HeaderName.AUTHORIZATION]).toBe('Bearer abc123')
  })

  it('injects basic auth', () => {
    const result = injectAuth('https://api.example.com', {}, { type: AuthType.BASIC, username: 'user', password: 'pass' })
    expect(result.headers[HeaderName.AUTHORIZATION]).toBe(`Basic ${btoa('user:pass')}`)
  })

  it('injects API key as header', () => {
    const result = injectAuth('https://api.example.com', {}, { type: AuthType.API_KEY, location: ParamLocation.HEADER, name: 'X-API-Key', value: 'secret' })
    expect(result.headers['X-API-Key']).toBe('secret')
  })

  it('injects API key as query param', () => {
    const result = injectAuth('https://api.example.com/data', {}, { type: AuthType.API_KEY, location: ParamLocation.QUERY, name: 'api_key', value: 'secret' })
    expect(result.url).toBe('https://api.example.com/data?api_key=secret')
  })

  it('injects oauth2 token', () => {
    const result = injectAuth('https://api.example.com', {}, { type: AuthType.OAUTH2, accessToken: 'token123' })
    expect(result.headers[HeaderName.AUTHORIZATION]).toBe('Bearer token123')
  })

  it('injects cookie auth', () => {
    const result = injectAuth('https://api.example.com', {}, { type: AuthType.COOKIE, name: 'session_id', value: 'abc123' })
    expect(result.headers[HeaderName.COOKIE]).toBe('session_id=abc123')
  })

  it('appends cookie auth to existing Cookie header', () => {
    const result = injectAuth('https://api.example.com', { [HeaderName.COOKIE]: 'existing=val' }, { type: AuthType.COOKIE, name: 'session_id', value: 'abc123' })
    expect(result.headers[HeaderName.COOKIE]).toBe('existing=val; session_id=abc123')
  })

  it('encodes special characters in cookie values', () => {
    const result = injectAuth('https://api.example.com', {}, { type: AuthType.COOKIE, name: 'data', value: 'val=ue;stuff' })
    expect(result.headers[HeaderName.COOKIE]).toBe('data=val%3Due%3Bstuff')
  })

  it('composes multiple auth schemes', () => {
    const result = injectAuth('https://api.example.com', {}, [
      { type: AuthType.BEARER, token: 'mytoken' },
      { type: AuthType.API_KEY, location: ParamLocation.HEADER, name: 'X-API-Key', value: 'secret' },
    ])
    expect(result.headers[HeaderName.AUTHORIZATION]).toBe('Bearer mytoken')
    expect(result.headers['X-API-Key']).toBe('secret')
  })
})

describe('maskAuth', () => {
  it('masks bearer token', () => {
    expect(maskAuth({ type: AuthType.BEARER, token: 'abc123456' })).toBe('Bearer abc1***')
  })

  it('masks basic auth', () => {
    expect(maskAuth({ type: AuthType.BASIC, username: 'user', password: 'secret' })).toBe('Basic user:***')
  })

  it('masks api key', () => {
    expect(maskAuth({ type: AuthType.API_KEY, location: ParamLocation.HEADER, name: 'X-API-Key', value: 'secret' })).toBe('X-API-Key: ***')
  })

  it('masks cookie auth', () => {
    expect(maskAuth({ type: AuthType.COOKIE, name: 'session_id', value: 'secret123' })).toBe('Cookie session_id=***')
  })

  it('masks oauth2', () => {
    expect(maskAuth({ type: AuthType.OAUTH2, accessToken: 'token123' })).toBe('OAuth2 ***')
  })

  it('masks short bearer tokens without exposing them', () => {
    expect(maskAuth({ type: AuthType.BEARER, token: 'abc' })).toBe('Bearer ***')
    expect(maskAuth({ type: AuthType.BEARER, token: '' })).toBe('Bearer ***')
    expect(maskAuth({ type: AuthType.BEARER, token: 'abcd' })).toBe('Bearer ***')
  })

  it('shows preview only for tokens longer than 4 chars', () => {
    expect(maskAuth({ type: AuthType.BEARER, token: 'abcde' })).toBe('Bearer abcd***')
  })
})

describe('refreshOAuth2Token', () => {
  it('sends correct refresh request and returns tokens', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'new_at',
        refresh_token: 'new_rt',
        expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    )

    const result = await refreshOAuth2Token(
      'https://auth.example.com/token',
      'rt_old',
      { clientId: 'cid', clientSecret: 'cs', scopes: ['read'], fetch: mockFetch },
    )

    expect(result.accessToken).toBe('new_at')
    expect(result.refreshToken).toBe('new_rt')
    expect(result.expiresIn).toBe(3600)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://auth.example.com/token')
    expect(init.method).toBe('POST')
    expect(init.body).toContain('grant_type=refresh_token')
    expect(init.body).toContain('refresh_token=rt_old')
    expect(init.body).toContain('client_id=cid')
    expect(init.body).toContain('client_secret=cs')
    expect(init.body).toContain('scope=read')
  })

  it('throws when refresh endpoint returns error, including response body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('invalid_grant', { status: 400, statusText: 'Bad Request' })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_expired', { fetch: mockFetch })
    ).rejects.toThrow('OAuth2 token refresh failed: 400 Bad Request: invalid_grant')
  })

  it('throws when response is 200 but missing access_token', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'server_error' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_old', { fetch: mockFetch })
    ).rejects.toThrow('missing required "access_token" field')
  })

  it('throws when response is 200 but body is not JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('<html>error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_old', { fetch: mockFetch })
    ).rejects.toThrow('not valid JSON')
  })

  it('throws ApiInvokeError with kind AUTH on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('invalid_grant', { status: 400, statusText: 'Bad Request' })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_expired', { fetch: mockFetch })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.AUTH,
      status: 400,
      retryable: false,
    })
  })

  it('throws ApiInvokeError with kind PARSE on invalid JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('<html>error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_old', { fetch: mockFetch })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.PARSE,
      retryable: false,
    })
  })

  it('throws ApiInvokeError with kind AUTH when access_token is empty string', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_old', { fetch: mockFetch })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.AUTH,
    })
  })

  it('includes body-read failure context when error body is unreadable', async () => {
    const badResponse = new Response(null, { status: 400, statusText: 'Bad Request' })
    vi.spyOn(badResponse, 'text').mockRejectedValue(new Error('stream closed'))
    const mockFetch = vi.fn().mockResolvedValue(badResponse)

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt_old', { fetch: mockFetch })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.AUTH,
      message: expect.stringContaining('stream closed'),
    })
  })

  it('marks 5xx refresh errors as retryable', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('internal error', { status: 503, statusText: 'Service Unavailable' })
    )

    await expect(
      refreshOAuth2Token('https://auth.example.com/token', 'rt', { fetch: mockFetch })
    ).rejects.toMatchObject({
      name: API_INVOKE_ERROR_NAME,
      kind: ErrorKind.AUTH,
      retryable: true,
    })
  })

  it('sends request without client credentials or scopes when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await refreshOAuth2Token('https://auth.example.com/token', 'rt', { fetch: mockFetch })

    const body = mockFetch.mock.calls[0][1].body
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=rt')
    expect(body).not.toContain('client_id')
    expect(body).not.toContain('client_secret')
    expect(body).not.toContain('scope')
  })
})
