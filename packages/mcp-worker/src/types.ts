/**
 * Types for the hosted MCP worker.
 * Uses Operation from api-invoke directly.
 */

import type { Operation, AuthConfigType, ParamLocation } from '@api2aux/api-invoke'

export { toAuth, AuthConfigType } from '@api2aux/api-invoke'
export type { AuthConfig } from '@api2aux/api-invoke'

// ── Storage interface (runtime-agnostic) ─────────────────────────────

export interface TenantStore {
  get(key: string): Promise<TenantConfig | null>
  put(key: string, config: TenantConfig, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

// ── Tenant configuration ─────────────────────────────────────────────

export interface TenantConfig {
  apiUrl: string
  baseUrl: string
  name: string
  /** Source type: 'openapi', 'graphql', or 'raw' */
  sourceType?: 'openapi' | 'graphql' | 'raw'
  authType: AuthConfigType
  authParamName?: string
  authSource?: ParamLocation
  operations: Operation[]
  createdAt: string
  expiresAt: string
}
