/**
 * Maps OpenAPI/Swagger security schemes to api-invoke auth types.
 */

import type { OpenAPIV3, OpenAPIV2 } from 'openapi-types'
import type { AuthScheme } from '../../core/types'
import { AuthType, ParamLocation } from '../../core/types'

/**
 * Map OpenAPI/Swagger security scheme definitions to api-invoke's {@link AuthScheme} array.
 * Supports apiKey, http (bearer/basic), oauth2, and basic (Swagger 2.0) types.
 * Unsupported schemes (e.g. openIdConnect) are mapped with `authType: null`.
 *
 * @param schemes - Security scheme definitions from the spec
 * @returns Array of normalized auth schemes
 */
export function mapSecuritySchemes(
  schemes: Record<string, OpenAPIV3.SecuritySchemeObject | OpenAPIV2.SecuritySchemeObject>,
): AuthScheme[] {
  const results: AuthScheme[] = []
  for (const [name, scheme] of Object.entries(schemes)) {
    results.push(mapSingleScheme(name, scheme))
  }
  return results
}

function mapSingleScheme(
  name: string,
  scheme: OpenAPIV3.SecuritySchemeObject | OpenAPIV2.SecuritySchemeObject,
): AuthScheme {
  const baseDescription = scheme.description || name

  // apiKey type (both OpenAPI 3.x and Swagger 2.0)
  if (scheme.type === 'apiKey') {
    const apiKeyScheme = scheme as OpenAPIV3.ApiKeySecurityScheme | OpenAPIV2.SecuritySchemeApiKey
    if (apiKeyScheme.in === ParamLocation.HEADER) {
      return { name, authType: AuthType.API_KEY, metadata: { headerName: apiKeyScheme.name }, description: baseDescription }
    }
    if (apiKeyScheme.in === ParamLocation.QUERY) {
      return { name, authType: AuthType.QUERY_PARAM, metadata: { paramName: apiKeyScheme.name }, description: baseDescription }
    }
    if (apiKeyScheme.in === ParamLocation.COOKIE) {
      return { name, authType: AuthType.COOKIE, metadata: { cookieName: apiKeyScheme.name }, description: baseDescription }
    }
    return { name, authType: null, metadata: {}, description: `${baseDescription} (unsupported: apiKey in "${apiKeyScheme.in}")` }
  }

  // http type (OpenAPI 3.x only)
  if (scheme.type === 'http') {
    const httpScheme = scheme as OpenAPIV3.HttpSecurityScheme
    if (httpScheme.scheme === AuthType.BEARER) {
      return { name, authType: AuthType.BEARER, metadata: {}, description: baseDescription }
    }
    if (httpScheme.scheme === AuthType.BASIC) {
      return { name, authType: AuthType.BASIC, metadata: {}, description: baseDescription }
    }
    return { name, authType: null, metadata: {}, description: `${baseDescription} (unsupported: HTTP scheme "${httpScheme.scheme}")` }
  }

  // basic type (Swagger 2.0 only)
  if (scheme.type === 'basic') {
    return { name, authType: AuthType.BASIC, metadata: {}, description: baseDescription }
  }

  // oauth2
  if (scheme.type === 'oauth2') {
    const metadata: Record<string, string> = {}

    // OpenAPI 3.x: flows object
    let flowResolved = false
    if ('flows' in scheme) {
      const oauth3 = scheme as OpenAPIV3.OAuth2SecurityScheme
      const flow = oauth3.flows.authorizationCode
        ?? oauth3.flows.clientCredentials
        ?? oauth3.flows.implicit
        ?? oauth3.flows.password
      if (flow) {
        flowResolved = true
        if ('authorizationUrl' in flow && flow.authorizationUrl) metadata.authorizationUrl = flow.authorizationUrl
        if ('tokenUrl' in flow && flow.tokenUrl) metadata.tokenUrl = flow.tokenUrl
        if (flow.refreshUrl) metadata.refreshUrl = flow.refreshUrl
        if (flow.scopes && Object.keys(flow.scopes).length > 0) {
          metadata.scopes = Object.keys(flow.scopes).join(',')
        }
      }
    }

    // Swagger 2.0: flat fields (use generic access since union types vary)
    if ('flow' in scheme) {
      flowResolved = true
      const oauth2 = scheme as unknown as Record<string, unknown>
      if (typeof oauth2.authorizationUrl === 'string') metadata.authorizationUrl = oauth2.authorizationUrl
      if (typeof oauth2.tokenUrl === 'string') metadata.tokenUrl = oauth2.tokenUrl
      const scopes = oauth2.scopes as Record<string, string> | undefined
      if (scopes && Object.keys(scopes).length > 0) {
        metadata.scopes = Object.keys(scopes).join(',')
      }
    }

    const description = flowResolved
      ? baseDescription
      : `${baseDescription} (OAuth2 detected but no supported flow found)`
    return { name, authType: AuthType.OAUTH2, metadata, description }
  }

  // openIdConnect
  if (scheme.type === 'openIdConnect') {
    return { name, authType: null, metadata: {}, description: `${baseDescription} (unsupported: OpenID Connect)` }
  }

  return { name, authType: null, metadata: {}, description: `${baseDescription} (unsupported: unknown scheme type)` }
}
