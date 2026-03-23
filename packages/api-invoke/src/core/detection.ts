/**
 * Heuristics for detecting API spec formats from URLs and content.
 * Used by `createClient()` for auto-detection and available for consumers
 * that implement their own detection pipelines.
 */

/**
 * Detect if a URL likely points to an OpenAPI/Swagger spec by URL pattern.
 * Checks for common spec file extensions and path patterns.
 *
 * @param url - Absolute URL to check
 * @returns `true` if the URL matches a known spec URL pattern
 */
export function isSpecUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return (
    lower.endsWith('/openapi.json') ||
    lower.endsWith('/openapi.yaml') ||
    lower.endsWith('/openapi.yml') ||
    lower.endsWith('/swagger.json') ||
    lower.endsWith('/swagger.yaml') ||
    lower.endsWith('/swagger.yml') ||
    lower.endsWith('/spec.json') ||
    lower.endsWith('/spec.yaml') ||
    lower.endsWith('/spec.yml') ||
    lower.endsWith('/api-docs') ||
    lower.endsWith('/api-docs.json') ||
    lower.endsWith('/api-docs.yaml') ||
    lower.endsWith('/v2/api-docs') ||
    lower.endsWith('/v3/api-docs') ||
    lower.includes('swagger') ||
    lower.includes('openapi')
  )
}

/**
 * Detect if a parsed JSON object is an OpenAPI/Swagger spec by checking
 * for the required top-level `openapi` (3.x) or `swagger` (2.0) key.
 *
 * @param data - Parsed JSON value to check
 * @returns `true` if the data looks like an OpenAPI/Swagger spec
 */
export function isSpecContent(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const obj = data as Record<string, unknown>
  return typeof obj.openapi === 'string' || typeof obj.swagger === 'string'
}

/**
 * Detect if a URL likely points to a GraphQL endpoint by URL pattern.
 * Checks for common GraphQL path suffixes.
 *
 * @param url - Absolute URL to check
 * @returns `true` if the URL matches a known GraphQL endpoint pattern
 */
export function isGraphQLUrl(url: string): boolean {
  try {
    return /\/graphql(?:$|[\/\?#])/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}
