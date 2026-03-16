import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithAuth, isAuthConfigured } from '../fetcher'
import { useAuthStore } from '../../../store/authStore'
import { AuthError, NetworkError } from '../errors'
import type { Credential } from '../../../types/auth'

// Mock the auth store
vi.mock('../../../store/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(),
  },
}))

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

/**
 * Create a complete mock Response compatible with api-invoke's executor.
 * The executor reads status, headers (forEach/get), json(), text(), clone().
 */
function mockResponse(data: unknown, overrides: { status?: number; statusText?: string; contentType?: string } = {}): Response {
  const status = overrides.status ?? 200
  const statusText = overrides.statusText ?? 'OK'
  const contentType = overrides.contentType ?? 'application/json'
  const body = typeof data === 'string' ? data : JSON.stringify(data)

  return new Response(body, {
    status,
    statusText,
    headers: { 'content-type': contentType },
  })
}

// In dev/test mode, URLs are rewritten through the CORS proxy.
function expectedProxyUrl(url: string): string {
  return `/api-proxy/${encodeURIComponent(url)}`
}

describe('fetchWithAuth', () => {
  const testUrl = 'https://api.example.com/data'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Bearer Token Authentication', () => {
    it('injects Authorization Bearer header', async () => {
      const credential: Credential = {
        type: 'bearer',
        label: 'Test Token',
        token: 'test-token-123',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)

      expect(mockFetch).toHaveBeenCalledWith(
        expectedProxyUrl(testUrl),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token-123',
          }),
        })
      )
    })
  })

  describe('Basic Authentication', () => {
    it('injects Authorization Basic header with btoa encoding', async () => {
      const credential: Credential = {
        type: 'basic',
        label: 'Test Basic',
        username: 'user',
        password: 'pass',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)

      const expectedAuth = `Basic ${btoa('user:pass')}`
      expect(mockFetch).toHaveBeenCalledWith(
        expectedProxyUrl(testUrl),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expectedAuth,
          }),
        })
      )
    })
  })

  describe('API Key Authentication', () => {
    it('injects custom header', async () => {
      const credential: Credential = {
        type: 'apiKey',
        label: 'Test API Key',
        headerName: 'X-API-Key',
        value: 'secret-key-456',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)

      expect(mockFetch).toHaveBeenCalledWith(
        expectedProxyUrl(testUrl),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'secret-key-456',
          }),
        })
      )
    })

    it('passes through unusual header names (validation deferred to fetch runtime)', async () => {
      const credential: Credential = {
        type: 'apiKey',
        label: 'Bad Header',
        headerName: '123-bad',
        value: 'value',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ '123-bad': 'value' }),
        })
      )
    })
  })

  describe('Cookie Authentication', () => {
    it('injects Cookie header', async () => {
      const credential: Credential = {
        type: 'cookie',
        label: 'Test Cookie',
        cookieName: 'session_id',
        value: 'abc123',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)

      expect(mockFetch).toHaveBeenCalledWith(
        expectedProxyUrl(testUrl),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Cookie': 'session_id=abc123',
          }),
        })
      )
    })
  })

  describe('Query Parameter Authentication', () => {
    it('appends query param to URL', async () => {
      const credential: Credential = {
        type: 'queryParam',
        label: 'Test Query Param',
        paramName: 'apiKey',
        value: 'query-key-789',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)

      const expectedUrl = 'https://api.example.com/data?apiKey=query-key-789'
      expect(mockFetch).toHaveBeenCalledWith(
        expectedProxyUrl(expectedUrl),
        expect.any(Object)
      )
    })

    it('replaces existing param with same name', async () => {
      const urlWithParam = 'https://api.example.com/data?apiKey=old-value&other=123'
      const credential: Credential = {
        type: 'queryParam',
        label: 'Test Query Param',
        paramName: 'apiKey',
        value: 'new-value',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(urlWithParam)

      const calledUrl = mockFetch.mock.calls[0]![0] as string
      // URL is proxied in dev mode, so decode to check query params
      const decodedUrl = decodeURIComponent(calledUrl.replace('/api-proxy/', ''))
      expect(decodedUrl).toContain('apiKey=new-value')
      expect(decodedUrl).not.toContain('apiKey=old-value')
      expect(decodedUrl).toContain('other=123')
    })
  })

  describe('Passthrough (no credentials)', () => {
    it('fetches without auth headers when no credential configured', async () => {
      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(null),
      } as any)

      mockFetch.mockResolvedValue(mockResponse({ success: true }))

      await fetchWithAuth(testUrl)

      expect(mockFetch).toHaveBeenCalledWith(
        expectedProxyUrl(testUrl),
        expect.any(Object)
      )

      const callHeaders = mockFetch.mock.calls[0]![1]?.headers as any
      expect(callHeaders?.Authorization).toBeUndefined()
    })
  })

  describe('401/403 AuthError detection', () => {
    it('throws AuthError with credential context on 401', async () => {
      const credential: Credential = {
        type: 'bearer',
        label: 'Test',
        token: 'test',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(
        mockResponse({ error: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' })
      )

      await expect(fetchWithAuth(testUrl)).rejects.toThrow(AuthError)

      mockFetch.mockResolvedValue(
        mockResponse({ error: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' })
      )

      try {
        await fetchWithAuth(testUrl)
      } catch (err) {
        const authErr = err as AuthError
        expect(authErr.status).toBe(401)
        expect(authErr.authContext).toBe('bearer auth')
        expect(authErr.responseBody).toContain('Invalid token')
      }
    })

    it('throws AuthError with credential context on 403', async () => {
      const credential: Credential = {
        type: 'apiKey',
        label: 'Test',
        headerName: 'X-API-Key',
        value: 'test',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(
        mockResponse({ error: 'Insufficient permissions' }, { status: 403, statusText: 'Forbidden' })
      )

      try {
        await fetchWithAuth(testUrl)
      } catch (err) {
        const authErr = err as AuthError
        expect(authErr.status).toBe(403)
        expect(authErr.authContext).toBe('apiKey auth')
        expect(authErr.responseBody).toContain('Insufficient permissions')
      }
    })

    it('throws AuthError with "no credentials configured" context on 401 without credentials', async () => {
      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(null),
      } as any)

      mockFetch.mockResolvedValue(
        mockResponse('<html>Unauthorized</html>', { status: 401, statusText: 'Unauthorized', contentType: 'text/html' })
      )

      try {
        await fetchWithAuth(testUrl)
      } catch (err) {
        const authErr = err as AuthError
        expect(authErr.status).toBe(401)
        expect(authErr.authContext).toBe('no credentials configured')
      }
    })

    it('includes JSON body in AuthError.responseBody', async () => {
      const credential: Credential = {
        type: 'bearer',
        label: 'Test',
        token: 'test',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(
        mockResponse({ error: 'Token expired', code: 'TOKEN_EXPIRED' }, { status: 401, statusText: 'Unauthorized' })
      )

      try {
        await fetchWithAuth(testUrl)
      } catch (err) {
        const authErr = err as AuthError
        expect(authErr.responseBody).toContain('Token expired')
        expect(authErr.responseBody).toContain('TOKEN_EXPIRED')
      }
    })

    it('includes non-JSON body as text in AuthError.responseBody', async () => {
      const credential: Credential = {
        type: 'bearer',
        label: 'Test',
        token: 'test',
      }

      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(credential),
      } as any)

      mockFetch.mockResolvedValue(
        mockResponse('<html><body>Unauthorized Access</body></html>', { status: 401, statusText: 'Unauthorized', contentType: 'text/html' })
      )

      try {
        await fetchWithAuth(testUrl)
      } catch (err) {
        const authErr = err as AuthError
        expect(authErr.responseBody).toContain('Unauthorized Access')
      }
    })
  })

  describe('Network errors', () => {
    it('throws NetworkError on fetch failure', async () => {
      vi.mocked(useAuthStore.getState).mockReturnValue({
        getActiveCredential: vi.fn().mockReturnValue(null),
      } as any)

      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(fetchWithAuth(testUrl)).rejects.toThrow(NetworkError)
    })
  })
})

describe('isAuthConfigured', () => {
  it('returns true when credential exists', () => {
    const credential: Credential = {
      type: 'bearer',
      label: 'Test',
      token: 'test',
    }

    vi.mocked(useAuthStore.getState).mockReturnValue({
      getActiveCredential: vi.fn().mockReturnValue(credential),
    } as any)

    expect(isAuthConfigured('https://api.example.com/data')).toBe(true)
  })

  it('returns false when no credential exists', () => {
    vi.mocked(useAuthStore.getState).mockReturnValue({
      getActiveCredential: vi.fn().mockReturnValue(null),
    } as any)

    expect(isAuthConfigured('https://api.example.com/data')).toBe(false)
  })
})
