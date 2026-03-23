/**
 * OpenAPI/Swagger spec parsing — delegates to api-invoke.
 */

import { parseOpenAPISpec as bridgeParse } from '@api2aux/api-invoke'
import type { ParsedAPI } from '@api2aux/api-invoke'

/**
 * Parse an OpenAPI/Swagger spec URL or object.
 *
 * @param specUrlOrObject - URL string or spec object
 * @param options - Parse options
 * @param options.specUrl - Original spec URL (used to resolve relative server URLs)
 * @returns Parsed API with operations, parameters, and metadata
 */
export async function parseOpenAPISpec(
  specUrlOrObject: string | object,
  options?: { specUrl?: string },
): Promise<ParsedAPI> {
  const specUrl = options?.specUrl ?? (typeof specUrlOrObject === 'string' ? specUrlOrObject : undefined)
  return bridgeParse(specUrlOrObject, { specUrl })
}
