/**
 * MCP Server that registers API operations as tools.
 * Accepts an OpenAPI spec URL or raw API URL and creates tools dynamically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { ParsedAPI, ExecutionResult, Auth } from 'api-invoke'
import { parseRawUrl, ApiInvokeError, ErrorKind } from 'api-invoke'
import { generateTools } from './tool-generator'
import type { GeneratedTool } from './tool-generator'
import { enrichTools } from './semantic-enrichment'
import { executeTool } from './tool-executor'
import { formatResponse } from './response-formatter'
import type { ServerConfig, AuthConfig } from './types'
import { toAuth, AuthConfigType } from './types'

/**
 * Parse auth config from CLI options.
 */
function parseAuth(config: ServerConfig): AuthConfig {
  if (config.token) {
    return { type: AuthConfigType.BEARER, token: config.token }
  }
  if (config.header) {
    const colonIdx = config.header.indexOf(':')
    if (colonIdx > 0) {
      return {
        type: AuthConfigType.HEADER,
        headerName: config.header.slice(0, colonIdx).trim(),
        headerValue: config.header.slice(colonIdx + 1).trim(),
      }
    }
  }
  if (config.apiKey) {
    const eqIdx = config.apiKey.indexOf('=')
    if (eqIdx > 0) {
      return {
        type: AuthConfigType.API_KEY,
        paramName: config.apiKey.slice(0, eqIdx),
        paramValue: config.apiKey.slice(eqIdx + 1),
      }
    }
  }
  return { type: AuthConfigType.NONE }
}

/**
 * Create and configure an MCP server from a config.
 * Returns the server instance (call .connect(transport) to start).
 */
export async function createServer(config: ServerConfig): Promise<McpServer> {
  const serverName = config.name || 'api2aux-mcp'

  const server = new McpServer({
    name: serverName,
    version: '0.1.0',
  })

  const auth = parseAuth(config)

  const debug = config.debug ?? false
  const fullResponse = config.fullResponse ?? false

  if (config.openapiUrl) {
    // OpenAPI mode: parse spec and generate tools for each operation
    await registerOpenAPITools(server, config.openapiUrl, auth, debug, fullResponse)
  } else if (config.apiUrl) {
    // Raw API mode: register a single fetch tool
    await registerRawAPITool(server, config.apiUrl, auth, config.name, debug, fullResponse)
  } else {
    throw new Error('Either --openapi or --api must be specified')
  }

  return server
}

/**
 * Mask sensitive values in headers for debug output.
 */
function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'authorization' || lower.includes('key') || lower.includes('secret') || lower.includes('token')) {
      // Show first 8 chars then mask
      masked[key] = value.length > 12 ? value.slice(0, 8) + '***' : '***'
    } else {
      masked[key] = value
    }
  }
  return masked
}

/**
 * Format debug info as a prefix string for tool responses.
 */
function formatDebugInfo(result: ExecutionResult, responseSize: number): string {
  const { method, url, headers } = result.request
  const maskedHeaders = maskHeaders(headers)
  const headerStr = Object.entries(maskedHeaders).map(([k, v]) => `${k}: ${v}`).join(', ')
  const sizeStr = responseSize > 1024 ? `${(responseSize / 1024).toFixed(1)}KB` : `${responseSize}B`
  return [
    `[DEBUG] ${method} ${url}`,
    `[DEBUG] Headers: ${headerStr}`,
    `[DEBUG] Status: ${result.status} | Response: ${sizeStr} | Time: ${result.elapsedMs}ms`,
    '',
  ].join('\n')
}

/**
 * Create a tool handler that executes an operation and formats the response.
 * Shared by both OpenAPI and raw API modes.
 */
function createToolHandler(
  baseUrl: string,
  tool: GeneratedTool,
  bridgeAuth: Auth | undefined,
  debug: boolean,
  fullResponse: boolean
) {
  return async (args: Record<string, unknown>) => {
    const showDebug = debug || args.debug === true
    const noTruncate = fullResponse || args.full_response === true
    try {
      const result = await executeTool(baseUrl, tool.operation, args, bridgeAuth, { debug: showDebug })
      const responseText = formatResponse(result.data, noTruncate)
      const prefix = showDebug
        ? formatDebugInfo(result, responseText.length)
        : ''

      if (result.status >= 400) {
        const label = result.errorKind === ErrorKind.RATE_LIMIT ? 'Rate limited'
          : result.errorKind === ErrorKind.AUTH ? 'Auth error'
          : `API error ${result.status}`
        return {
          content: [{
            type: 'text' as const,
            text: `${prefix}${label}: ${responseText}`,
          }],
          isError: true,
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: `${prefix}${responseText}`,
        }],
      }
    } catch (err) {
      if (err instanceof ApiInvokeError) {
        const prefix = err.kind === ErrorKind.RATE_LIMIT ? 'Rate limited'
          : err.kind === ErrorKind.AUTH ? 'Authentication failed'
          : err.kind === ErrorKind.TIMEOUT ? 'Request timed out'
          : err.kind === ErrorKind.NETWORK ? 'Network error'
          : err.kind === ErrorKind.CORS ? 'CORS error'
          : 'Request failed'
        const suggestion = err.suggestion ? ` Suggestion: ${err.suggestion}` : ''
        return {
          content: [{
            type: 'text' as const,
            text: `${prefix}: ${err.message}${suggestion}`,
          }],
          isError: true,
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      }
    }
  }
}

/**
 * Register tools on an MCP server from generated tool definitions.
 */
function registerToolsOnServer(
  server: McpServer,
  tools: GeneratedTool[],
  baseUrl: string,
  bridgeAuth: Auth | undefined,
  debug: boolean,
  fullResponse: boolean
): void {
  for (const tool of tools) {
    const toolSchema = {
      ...tool.inputSchema,
      debug: z.boolean().optional().describe('Set to true to see the request URL, headers, and timing'),
      full_response: z.boolean().optional().describe('Set to true to disable truncation and return the full response'),
    }

    const hasInputs = Object.keys(tool.inputSchema).length > 0
    const handler = createToolHandler(baseUrl, tool, bridgeAuth, debug, fullResponse)

    if (hasInputs) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: toolSchema },
        handler
      )
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: { debug: toolSchema.debug } },
        handler
      )
    }
  }
}

/**
 * Parse an OpenAPI spec and register each operation as an MCP tool.
 */
async function registerOpenAPITools(
  server: McpServer,
  specUrl: string,
  auth: AuthConfig,
  debug: boolean,
  fullResponse: boolean
): Promise<void> {
  let spec: ParsedAPI

  try {
    spec = await parseOpenAPISpec(specUrl)
  } catch (err) {
    throw new Error(`Failed to parse OpenAPI spec at ${specUrl}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const baseUrl = spec.baseUrl
  const rawTools = generateTools(spec.operations)
  const bridgeAuth = toAuth(auth)

  console.error(`[api2aux-mcp] Parsed "${spec.title}" v${spec.version} (${spec.specFormat})`)
  console.error(`[api2aux-mcp] Base URL: ${baseUrl}`)
  console.error(`[api2aux-mcp] Enriching ${rawTools.length} tools with semantic analysis...`)

  const tools = await enrichTools(rawTools, baseUrl, { fetchSamples: true })

  console.error(`[api2aux-mcp] Registering ${tools.length} tools...`)

  registerToolsOnServer(server, tools, baseUrl, bridgeAuth, debug, fullResponse)

  console.error(`[api2aux-mcp] ${tools.length} tools registered`)
}

/**
 * Sanitize a string into a valid tool name segment.
 * e.g. "my-api" → "my_api"
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Register tools for a raw API URL using parseRawUrl().
 * Uses the same generateTools → enrichTools → register pipeline as OpenAPI mode.
 */
async function registerRawAPITool(
  server: McpServer,
  apiUrl: string,
  auth: AuthConfig,
  serverName: string | undefined,
  debug: boolean,
  fullResponse: boolean
): Promise<void> {
  console.error(`[api2aux-mcp] Raw API mode: ${apiUrl}`)

  const spec = parseRawUrl(apiUrl)
  const baseUrl = spec.baseUrl
  const bridgeAuth = toAuth(auth)
  const rawTools = generateTools(spec.operations)

  // Override tool name from server name or hostname
  const parsed = new URL(apiUrl)
  let toolName: string
  if (serverName) {
    toolName = `fetch_${sanitizeName(serverName)}`
  } else {
    const hostParts = parsed.hostname.replace(/^(www|api)\./, '').split('.')
    toolName = hostParts[0] ? `fetch_${sanitizeName(hostParts[0])}` : 'fetch_api'
  }

  // Enrich with semantic analysis (best-effort sample fetch)
  console.error(`[api2aux-mcp] Enriching tool with semantic analysis...`)
  const tools = await enrichTools(rawTools, baseUrl, { fetchSamples: true })

  // Override the auto-generated name
  for (const tool of tools) {
    tool.name = toolName
  }

  const paramCount = spec.operations[0]?.parameters.length ?? 0
  console.error(`[api2aux-mcp] Registering ${tools.length} tool(s)...`)

  registerToolsOnServer(server, tools, baseUrl, bridgeAuth, debug, fullResponse)

  console.error(`[api2aux-mcp] ${tools.length} tool registered (${toolName}) with ${paramCount} query parameters`)
}
