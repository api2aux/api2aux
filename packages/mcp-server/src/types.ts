/**
 * Configuration types for the MCP server.
 */

export { toAuth, AuthConfigType } from 'api-bridge-rt'
export type { AuthConfig } from 'api-bridge-rt'

export interface ServerConfig {
  /** API URL to proxy (for raw JSON APIs) */
  apiUrl?: string
  /** OpenAPI/Swagger spec URL */
  openapiUrl?: string
  /** Server name (shown in MCP clients) */
  name?: string
  /** Bearer token for API auth */
  token?: string
  /** Custom header auth: "Header-Name: value" */
  header?: string
  /** API key query param: "param_name=value" */
  apiKey?: string
  /** Enable debug output (show request URL, headers, timing) */
  debug?: boolean
  /** Disable response truncation (return full response) */
  fullResponse?: boolean
}
