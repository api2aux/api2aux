/**
 * Base URL resolution for OpenAPI specs.
 * Handles servers array (3.x), host+basePath (2.0), and fallback to spec URL.
 */

import type { OpenAPIV3, OpenAPIV2 } from 'openapi-types'

/**
 * Extract base URL from OpenAPI 3.x servers array.
 * Interpolates server variables using their default value or first enum value.
 * Resolves relative server URLs (e.g. "/", "/api/v1") against the spec URL when provided.
 * Returns '' when no server is defined or a relative URL can't be resolved.
 *
 * @param api - The parsed OpenAPI 3.x document
 * @param specUrl - Optional spec URL used to resolve relative server URLs
 */
export function extractOpenAPI3BaseUrl(api: OpenAPIV3.Document, specUrl?: string): string {
  const server = api.servers?.[0]
  if (!server) return ''

  let url = server.url

  // Interpolate server variables with defaults
  if (server.variables) {
    for (const [name, variable] of Object.entries(server.variables)) {
      const value = variable.default ?? variable.enum?.[0]
      if (value === undefined) return ''
      url = url.replaceAll(`{${name}}`, String(value))
    }
  }

  // Resolve relative server URLs against the spec URL
  if (url && !url.startsWith('http')) {
    if (!specUrl) return ''
    try {
      const resolved = new URL(url, specUrl)
      return resolved.origin + resolved.pathname.replace(/\/$/, '')
    } catch {
      return ''
    }
  }

  return url
}

/**
 * Extract base URL from Swagger 2.0 host, basePath, and schemes.
 * Per the Swagger 2.0 spec, when host is omitted the host serving the
 * documentation is assumed to be the API host — so we fall back to
 * the spec URL's origin when available.
 */
export function extractSwagger2BaseUrl(api: OpenAPIV2.Document, specUrl?: string): string {
  let host = api.host
  let scheme = api.schemes?.[0] ?? 'https'

  if (!host && specUrl) {
    try {
      const u = new URL(specUrl)
      host = u.host
      scheme = api.schemes?.[0] ?? u.protocol.replace(':', '')
    } catch {
      // invalid specUrl — host stays empty, function returns '' below,
      // and the caller's deriveBaseUrl fallback in parser.ts handles the final attempt
    }
  }

  if (!host) return ''
  const basePath = api.basePath ?? ''
  return `${scheme}://${host}${basePath}`
}
