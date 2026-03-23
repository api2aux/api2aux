/**
 * Shared CORS proxy core — platform-agnostic.
 *
 * Pure functions using web-standard Request/Response types.
 * Consumed by platform adapters (Hono route, edge functions, etc.).
 */

/** Headers stripped from all proxied requests regardless of platform. */
const STRIPPED_HEADERS = new Set([
  'host',
  'origin',
  'cookie',
  'accept-encoding',
  'connection',
])

/**
 * Filter and rewrite incoming request headers for proxying.
 *
 * - Strips browser/transport headers that would confuse the upstream (host, origin, cookie, connection).
 * - Strips accept-encoding to prevent double-compression: the proxy server may
 *   re-compress the response, so the upstream must return uncompressed data.
 * - Rewrites referer to the target origin.
 * - Drops non-string header values (e.g. arrays from duplicate headers).
 *
 * @param incoming - Raw request headers as key-value pairs
 * @param targetOrigin - The origin to set as the referer (e.g. `https://api.example.com`)
 * @param extraSkip - Additional platform-specific headers to strip (e.g. `cf-ray`, `x-forwarded-for`)
 */
export function filterProxyHeaders(
  incoming: Record<string, string | string[] | undefined>,
  targetOrigin: string,
  extraSkip?: Set<string>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(incoming)) {
    if (STRIPPED_HEADERS.has(key)) continue
    if (extraSkip?.has(key)) continue
    if (key === 'referer') {
      headers['referer'] = targetOrigin + '/'
      continue
    }
    if (typeof value === 'string') headers[key] = value
  }
  return headers
}

/** Standard CORS preflight response shared across all proxy adapters. */
export function handleCorsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * Proxy a request to a target URL, returning the upstream response with CORS headers.
 *
 * Encapsulates the full proxy flow: filter headers, forward request body,
 * return upstream response with `Access-Control-Allow-Origin: *`.
 *
 * @param request - The incoming web-standard Request
 * @param targetUrl - The fully-qualified upstream URL to proxy to
 * @param extraSkipHeaders - Additional platform-specific headers to strip
 * @returns The upstream Response with CORS headers added
 */
export async function proxyRequest(
  request: Request,
  targetUrl: string,
  extraSkipHeaders?: Set<string>,
): Promise<Response> {
  const parsed = new URL(targetUrl)

  // Convert request headers to a plain object for filtering
  const incoming: Record<string, string> = {}
  for (const [key, value] of request.headers.entries()) {
    incoming[key] = value
  }

  const headers = filterProxyHeaders(incoming, parsed.origin, extraSkipHeaders)

  // Forward body for non-GET/HEAD methods
  let body: ArrayBuffer | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer()
  }

  const resp = await fetch(targetUrl, {
    method: request.method,
    headers,
    ...(body && body.byteLength > 0 ? { body } : {}),
  })

  const responseHeaders = new Headers(resp.headers)
  // fetch() auto-decompresses the response, so the original content-encoding
  // and content-length (which reflect the compressed payload) are now wrong.
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')
  // Prevent the browser from showing a native auth dialog for proxied 401s —
  // the app handles auth itself via the UI.
  responseHeaders.delete('www-authenticate')
  responseHeaders.set('Access-Control-Allow-Origin', '*')

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
  })
}
