/**
 * Types for the hosted MCP worker.
 * Uses Operation from api-bridge-rt directly.
 */

import type { Operation, AuthConfigType, ParamLocation } from 'api-bridge-rt'

export { toAuth, AuthConfigType } from 'api-bridge-rt'
export type { AuthConfig } from 'api-bridge-rt'

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
  authType: AuthConfigType
  authParamName?: string
  authSource?: ParamLocation
  operations: Operation[]
  createdAt: string
  expiresAt: string
}
