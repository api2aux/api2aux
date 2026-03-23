/**
 * OAuth2 token refresh fetch wrapper.
 * Intercepts 401 responses, refreshes the token, and retries the request.
 *
 * Note: Requests with `ReadableStream` bodies cannot be retried — if a stream body
 * is detected after a 401, the original response is returned with a warning.
 */

import { refreshOAuth2Token } from '../core/auth'
import type { OAuth2TokenResult } from '../core/auth'

/** Configuration for the OAuth2 token refresh fetch wrapper ({@link withOAuthRefresh}). */
export interface OAuthRefreshOptions {
  /** OAuth2 token endpoint URL. */
  tokenUrl: string
  /** Refresh token to exchange for a new access token. */
  refreshToken: string
  /** OAuth2 client ID (if required by the token endpoint). */
  clientId?: string
  /** OAuth2 client secret (if required by the token endpoint). */
  clientSecret?: string
  /** OAuth2 scopes to request. */
  scopes?: string[]
  /** Called after a successful token refresh. Use this to persist the new tokens. May be async. */
  onTokenRefresh?: (tokens: OAuth2TokenResult) => void | Promise<void>
}

/**
 * Create a fetch wrapper that auto-refreshes OAuth2 tokens on 401 responses.
 * On a 401, exchanges the refresh token for a new access token and retries the original request.
 * Concurrent 401s are deduplicated — only one refresh and one `onTokenRefresh` callback fire per refresh cycle.
 *
 * @param options - Refresh configuration (token URL, refresh token, client credentials)
 * @param baseFetch - Base fetch function to wrap. Defaults to `globalThis.fetch`.
 * @returns A fetch-compatible function with auto-refresh behavior
 *
 * @example
 * ```ts
 * const client = await createClient(specUrl, {
 *   auth: { type: AuthType.OAUTH2, accessToken: 'current-token' },
 *   fetch: withOAuthRefresh({
 *     tokenUrl: 'https://auth.example.com/token',
 *     refreshToken: 'rt_...',
 *     onTokenRefresh: (tokens) => saveTokens(tokens),
 *   }),
 * })
 * ```
 */
export function withOAuthRefresh(
  options: OAuthRefreshOptions,
  baseFetch?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const fetchFn = baseFetch ?? globalThis.fetch
  let currentRefreshToken = options.refreshToken
  let refreshPromise: Promise<OAuth2TokenResult> | null = null

  return async function oauthRefreshFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetchFn(input, init)

    if (response.status !== 401) return response

    // Cannot retry requests with stream bodies — the stream was consumed on the first attempt
    if (
      init?.body instanceof ReadableStream ||
      (typeof init?.body === 'object' && init.body !== null && Symbol.asyncIterator in (init.body as object)) ||
      (typeof init?.body === 'object' && init.body !== null && typeof (init.body as { pipe?: unknown }).pipe === 'function')
    ) {
      console.warn(
        '[api-invoke] Cannot retry request with stream body after 401 — the stream was consumed. Use a string or Blob body for OAuth2-protected requests.',
      )
      return response
    }

    // Deduplicate concurrent refresh attempts — refresh + callback fire exactly once per cycle
    let tokens: OAuth2TokenResult
    try {
      if (!refreshPromise) {
        refreshPromise = refreshOAuth2Token(options.tokenUrl, currentRefreshToken, {
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          scopes: options.scopes,
          fetch: fetchFn,
        }).then(async (result) => {
          if (result.refreshToken) currentRefreshToken = result.refreshToken

          if (options.onTokenRefresh) {
            try {
              await options.onTokenRefresh(result)
            } catch (callbackError) {
              console.warn(
                '[api-invoke] onTokenRefresh callback threw — new tokens were NOT persisted. ' +
                'The refreshed token is used for this request, but may be lost on restart.',
                callbackError,
              )
            }
          }

          return result
        }).finally(() => { refreshPromise = null })
      }
      tokens = await refreshPromise
    } catch (error) {
      // Refresh failed — return the original 401
      console.warn(
        '[api-invoke] OAuth2 token refresh failed, returning original 401.',
        error,
      )
      return response
    }

    // Retry original request with updated Authorization header
    // Merge headers from both the Request object (if input is a Request) and init
    let baseHeaders: Record<string, string> = {}
    if (input instanceof Request) {
      input.headers.forEach((value, key) => { baseHeaders[key] = value })
    }
    const initHeaders: Record<string, string> =
      typeof init?.headers === 'object' && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
        ? { ...(init.headers as Record<string, string>) }
        : Object.fromEntries(new Headers(init?.headers).entries())
    const existingHeaders: Record<string, string> = { ...baseHeaders, ...initHeaders }
    // Remove any existing authorization header (case-insensitive) before setting the new one
    for (const key of Object.keys(existingHeaders)) {
      if (key.toLowerCase() === 'authorization') delete existingHeaders[key]
    }
    existingHeaders['Authorization'] = `Bearer ${tokens.accessToken}`
    return fetchFn(input, { ...init, headers: existingHeaders })
  }
}
