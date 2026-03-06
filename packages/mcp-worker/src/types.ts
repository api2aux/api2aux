/**
 * Types for the hosted MCP worker.
 * SerializableOperation/Parameter mirror ParsedOperation/Parameter from
 * @api2aux/semantic-analysis but are defined locally to avoid pulling in
 * swagger-parser (which uses Node.js fs).
 */

// ── Storage interface (runtime-agnostic) ─────────────────────────────

export interface TenantStore {
  get(key: string): Promise<TenantConfig | null>
  put(key: string, config: TenantConfig, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

// ── Tenant configuration (stored in KV) ──────────────────────────────

export interface TenantConfig {
  apiUrl: string
  baseUrl: string
  name: string
  authType: 'bearer' | 'header' | 'apikey' | 'none'
  authParamName?: string
  authSource?: 'query' | 'header'
  operations: SerializableOperation[]
  createdAt: string
  expiresAt: string
}

// ── Serializable OpenAPI types (mirrors ParsedOperation) ─────────────

export interface SerializableParameter {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required: boolean
  description: string
  schema: {
    type: string
    format?: string
    enum?: unknown[]
    default?: unknown
    example?: unknown
    minimum?: number
    maximum?: number
    maxLength?: number
  }
}

export interface SerializableRequestBody {
  required: boolean
  description?: string
  schema: {
    type: string
    properties?: Record<string, {
      type: string
      format?: string
      description?: string
      enum?: unknown[]
      default?: unknown
      example?: unknown
      nested?: boolean
    }>
    required?: string[]
    raw: unknown
  }
}

export interface SerializableOperation {
  path: string
  method: string
  operationId?: string
  summary?: string
  description?: string
  parameters: SerializableParameter[]
  requestBody?: SerializableRequestBody
  responseSchema: unknown
  tags: string[]
}

// ── Auth config for tool execution ───────────────────────────────────

export interface AuthConfig {
  type: 'bearer' | 'header' | 'apikey' | 'none'
  token?: string
  headerName?: string
  headerValue?: string
  paramName?: string
  paramValue?: string
}
