/**
 * Flat auth configuration for CLI consumers.
 * Converts simple config objects (from CLI args, env vars, config files)
 * into api-invoke's discriminated Auth union.
 */

import type { Auth } from './types'
import { AuthType, ParamLocation } from './types'

/** Simplified auth type constants for flat configuration (CLI, env vars, config files). */
export const AuthConfigType = {
  BEARER: 'bearer',
  HEADER: 'header',
  API_KEY: 'apikey',
  NONE: 'none',
} as const
export type AuthConfigType = (typeof AuthConfigType)[keyof typeof AuthConfigType]

/**
 * Flat auth configuration for CLI consumers.
 * Unlike {@link Auth}, this is a single object with optional fields rather than a discriminated union.
 * Use {@link toAuth} to convert to the full `Auth` type.
 */
export interface AuthConfig {
  /** Auth type to use. */
  type: AuthConfigType
  /** Bearer token (used when `type` is 'bearer'). */
  token?: string
  /** Custom header name (used when `type` is 'header'). */
  headerName?: string
  /** Custom header value (used when `type` is 'header'). */
  headerValue?: string
  /** Query parameter name (used when `type` is 'apikey'). */
  paramName?: string
  /** Query parameter value (used when `type` is 'apikey'). */
  paramValue?: string
}

/**
 * Convert a flat {@link AuthConfig} to api-invoke's {@link Auth} discriminated union.
 * Returns undefined if required credentials are missing or type is `NONE`.
 *
 * @param config - Flat auth configuration
 * @returns The `Auth` object, or undefined if credentials are incomplete
 */
export function toAuth(config: AuthConfig): Auth | undefined {
  switch (config.type) {
    case AuthConfigType.BEARER:
      return config.token ? { type: AuthType.BEARER, token: config.token } : undefined
    case AuthConfigType.HEADER:
      return config.headerName && config.headerValue
        ? { type: AuthType.API_KEY, location: ParamLocation.HEADER, name: config.headerName, value: config.headerValue }
        : undefined
    case AuthConfigType.API_KEY:
      return config.paramName && config.paramValue
        ? { type: AuthType.API_KEY, location: ParamLocation.QUERY, name: config.paramName, value: config.paramValue }
        : undefined
    case AuthConfigType.NONE:
      return undefined
  }
}
