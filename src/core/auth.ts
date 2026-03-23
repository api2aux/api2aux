/**
 * Authentication injection into HTTP requests.
 * Supports Bearer, Basic, API Key (header/query), OAuth2, and Cookie.
 */

import type { Auth } from './types'
import { AuthType, HeaderName, ParamLocation } from './types'
import { ApiInvokeError, ErrorKind } from './errors'

/**
 * A request with authentication applied (URL may be modified for query-based auth).
 */
export interface AuthenticatedRequest {
  /** URL, potentially modified with query-based auth parameters. */
  url: string
  /** Headers with auth credentials injected. */
  headers: Record<string, string>
}

/**
 * Inject authentication credentials into a request URL and headers.
 * Accepts a single Auth or an array for composing multiple schemes (e.g. API key + bearer).
 *
 * @param url - The request URL
 * @param headers - Existing request headers (shallow-copied internally)
 * @param auth - Credentials to inject (single or array)
 * @returns New URL and headers with auth applied
 */
export function injectAuth(
  url: string,
  headers: Record<string, string>,
  auth: Auth | Auth[],
): AuthenticatedRequest {
  if (Array.isArray(auth)) {
    // Apply auth schemes in order. Later entries override earlier ones for the same header (e.g. Authorization), but cookie auth appends.
    let result: AuthenticatedRequest = { url, headers: { ...headers } }
    for (const a of auth) {
      result = injectAuth(result.url, result.headers, a)
    }
    return result
  }

  const result = { url, headers: { ...headers } }

  switch (auth.type) {
    case AuthType.BEARER:
      result.headers[HeaderName.AUTHORIZATION] = `Bearer ${auth.token}`
      break

    case AuthType.BASIC: {
      // btoa is available in all modern browsers and Node 16+
      const encoded = btoa(`${auth.username}:${auth.password}`)
      result.headers[HeaderName.AUTHORIZATION] = `Basic ${encoded}`
      break
    }

    case AuthType.API_KEY:
      if (auth.location === ParamLocation.HEADER) {
        result.headers[auth.name] = auth.value
      } else if (auth.location === ParamLocation.QUERY) {
        const u = new URL(url)
        u.searchParams.set(auth.name, auth.value)
        result.url = u.toString()
      }
      break

    case AuthType.OAUTH2:
      result.headers[HeaderName.AUTHORIZATION] = `Bearer ${auth.accessToken}`
      break

    case AuthType.COOKIE: {
      const existing = result.headers[HeaderName.COOKIE]
      const cookie = `${encodeURIComponent(auth.name)}=${encodeURIComponent(auth.value)}`
      result.headers[HeaderName.COOKIE] = existing ? `${existing}; ${cookie}` : cookie
      break
    }
  }

  return result
}

/** Result from an OAuth2 token refresh. */
export interface OAuth2TokenResult {
  /** The new access token. */
  accessToken: string
  /** A new refresh token, if the server issued one. */
  refreshToken?: string
  /** Token lifetime in seconds, if provided by the server. */
  expiresIn?: number
}

/**
 * Exchange a refresh token for a new access token at the OAuth2 token endpoint.
 *
 * @param tokenUrl - The OAuth2 token endpoint URL
 * @param refreshToken - The refresh token to exchange
 * @param options - Optional client credentials, scopes, and custom fetch
 * @returns The new token set
 * @throws {ApiInvokeError} With `kind: 'auth'` if the token endpoint returns a non-OK response or the response is missing `access_token`
 * @throws {ApiInvokeError} With `kind: 'parse'` if the response body is not valid JSON
 */
export async function refreshOAuth2Token(
  tokenUrl: string,
  refreshToken: string,
  options?: {
    clientId?: string
    clientSecret?: string
    scopes?: string[]
    fetch?: typeof globalThis.fetch
  },
): Promise<OAuth2TokenResult> {
  const fetchFn = options?.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  if (options?.clientId) body.set('client_id', options.clientId)
  if (options?.clientSecret) body.set('client_secret', options.clientSecret)
  if (options?.scopes?.length) body.set('scope', options.scopes.join(' '))

  const response = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    let errorDetail = ''
    try {
      const body = await response.text()
      errorDetail = body ? `: ${body.slice(0, 500)}` : ''
    } catch (bodyReadError) {
      errorDetail = ` (error body unreadable: ${bodyReadError instanceof Error ? bodyReadError.message : String(bodyReadError)})`
    }
    throw new ApiInvokeError({
      kind: ErrorKind.AUTH,
      message: `OAuth2 token refresh failed: ${response.status} ${response.statusText}${errorDetail}`,
      suggestion: 'Check the refresh token, client credentials, and token endpoint URL.',
      retryable: response.status >= 500,
      status: response.status,
    })
  }

  let data: Record<string, unknown>
  try {
    data = await response.json() as Record<string, unknown>
  } catch (parseError) {
    throw new ApiInvokeError({
      kind: ErrorKind.PARSE,
      message: `OAuth2 token refresh succeeded (${response.status}) but response body is not valid JSON`,
      suggestion: 'The token endpoint returned a non-JSON response. Verify the endpoint URL.',
      retryable: false,
    })
  }

  const accessToken = data.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new ApiInvokeError({
      kind: ErrorKind.AUTH,
      message: `OAuth2 token refresh response missing required "access_token" field. Got keys: [${Object.keys(data).join(', ')}]`,
      suggestion: 'The token endpoint response did not include a valid access_token. Verify the endpoint and grant type.',
      retryable: false,
    })
  }

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
  }
}

/**
 * Mask credential values for safe logging. Shows the auth type and a redacted value.
 *
 * @param auth - The auth credentials to mask
 * @returns A human-readable string with sensitive values replaced by `***`
 */
export function maskAuth(auth: Auth): string {
  switch (auth.type) {
    case AuthType.BEARER: {
      if (auth.token.length <= 4) return 'Bearer ***'
      return `Bearer ${auth.token.substring(0, 4)}***`
    }
    case AuthType.BASIC:
      return `Basic ${auth.username}:***`
    case AuthType.API_KEY:
      return `${auth.name}: ***`
    case AuthType.OAUTH2:
      return `OAuth2 ***`
    case AuthType.COOKIE:
      return `Cookie ${auth.name}=***`
  }
}
