/**
 * Configuration types for the MCP server.
 */

export { toAuth, AuthConfigType } from 'api-invoke'
export type { AuthConfig } from 'api-invoke'

export interface ServerConfig {
  /** API URL to proxy (for raw JSON APIs) */
  apiUrl?: string
  /** OpenAPI/Swagger spec URL */
  openapiUrl?: string
  /** GraphQL endpoint URL */
  graphqlUrl?: string
  /** Server name (shown in MCP clients) */
  name?: string
  /** Bearer token for API auth */
  token?: string
  /** Custom header auth: "Header-Name: value" */
  header?: string
  /** API key query param: "param_name=value" */
  apiKey?: string
  /** Cookie auth: "name=value" */
  cookie?: string
  /** Enable debug output (show request URL, headers, timing) */
  debug?: boolean
  /** Disable response truncation (return full response) */
  fullResponse?: boolean
  /** Enrichment plugin npm package names to load (e.g. ['@yourco/enrich-commerce']) */
  enrichmentPlugins?: string[]
}
