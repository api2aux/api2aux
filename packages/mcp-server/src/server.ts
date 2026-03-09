/**
 * MCP Server that registers API operations as tools.
 * Accepts an OpenAPI spec URL or raw API URL and creates tools dynamically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { ParsedAPI } from 'api-bridge-rt'
import { injectAuth } from 'api-bridge-rt'
import { generateTools } from './tool-generator'
import { enrichTools, describeFieldsFromData } from './semantic-enrichment'
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
function formatDebugInfo(
  method: string,
  url: string,
  headers: Record<string, string>,
  status: number,
  responseSize: number,
  elapsedMs: number
): string {
  const maskedHeaders = maskHeaders(headers)
  const headerStr = Object.entries(maskedHeaders).map(([k, v]) => `${k}: ${v}`).join(', ')
  const sizeStr = responseSize > 1024 ? `${(responseSize / 1024).toFixed(1)}KB` : `${responseSize}B`
  return [
    `[DEBUG] ${method} ${url}`,
    `[DEBUG] Headers: ${headerStr}`,
    `[DEBUG] Status: ${status} | Response: ${sizeStr} | Time: ${elapsedMs}ms`,
    '',
  ].join('\n')
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

  for (const tool of tools) {
    // Add debug + full_response params to input schema
    const toolSchema = {
      ...tool.inputSchema,
      debug: z.boolean().optional().describe('Set to true to see the request URL, headers, and timing'),
      full_response: z.boolean().optional().describe('Set to true to disable truncation and return the full response'),
    }

    const hasInputs = Object.keys(tool.inputSchema).length > 0

    const handler = async (args: Record<string, unknown>) => {
      const showDebug = debug || args.debug === true
      const noTruncate = fullResponse || args.full_response === true
      try {
        const result = await executeTool(baseUrl, tool.operation, args, bridgeAuth)
        const responseText = formatResponse(result.data, noTruncate)
        const prefix = showDebug
          ? formatDebugInfo(result.request.method, result.request.url, result.request.headers, result.status, responseText.length, result.elapsedMs)
          : ''

        if (result.status >= 400) {
          return {
            content: [{
              type: 'text' as const,
              text: `${prefix}API error ${result.status}: ${responseText}`,
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
        return {
          content: [{
            type: 'text' as const,
            text: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        }
      }
    }

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

  console.error(`[api2aux-mcp] ${tools.length} tools registered`)
}

/**
 * Sanitize a query param name into a valid JS identifier.
 * e.g. "filter[name]" → "filter_name"
 */
function sanitizeParamName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Register a single "fetch" tool for a raw API URL.
 * Parses query params from the URL and exposes each as an individual
 * tool parameter with its default value, so Claude can override any
 * param cleanly without duplication.
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

  const bridgeAuth = toAuth(auth)

  // Parse URL into base path and individual query params
  const parsed = new URL(apiUrl)
  const baseUrl = `${parsed.origin}${parsed.pathname}`
  const defaultParams: Array<{ original: string; sanitized: string; defaultValue: string }> = []
  const seenSanitized = new Set<string>()

  for (const [key, value] of parsed.searchParams.entries()) {
    let sanitized = sanitizeParamName(key)
    // Handle collisions by appending a number
    if (seenSanitized.has(sanitized)) {
      let i = 2
      while (seenSanitized.has(`${sanitized}_${i}`)) i++
      sanitized = `${sanitized}_${i}`
    }
    seenSanitized.add(sanitized)
    defaultParams.push({ original: key, sanitized, defaultValue: value })
  }

  // Build Zod input schema: path + each query param
  const inputSchema: Record<string, z.ZodTypeAny> = {
    path: z.string().optional().describe('Additional path segment to append (e.g., "/users/1")'),
  }

  for (const param of defaultParams) {
    const desc = param.original !== param.sanitized
      ? `Query param "${param.original}" (default: "${param.defaultValue}")`
      : `(default: "${param.defaultValue}")`
    inputSchema[param.sanitized] = z.string().optional().describe(desc)
  }

  // Debug + truncation params for per-request control
  inputSchema['debug'] = z.boolean().optional().describe('Set to true to see the request URL, headers, and timing')
  inputSchema['full_response'] = z.boolean().optional().describe('Set to true to disable truncation and return the full response')

  const paramCount = defaultParams.length
  let description = paramCount > 0
    ? `Fetch data from ${baseUrl} with ${paramCount} configurable query parameters. Each parameter has a default value that can be overridden.`
    : `Fetch data from ${apiUrl}. Optionally append a path.`

  // Fetch sample data and enrich description with semantic field info
  try {
    console.error(`[api2aux-mcp] Enriching tool with semantic analysis...`)
    const sampleUrl = paramCount > 0
      ? `${baseUrl}?${defaultParams.map(p => `${encodeURIComponent(p.original)}=${encodeURIComponent(p.defaultValue)}`).join('&')}`
      : apiUrl
    const sampleResponse = await fetch(sampleUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (sampleResponse.ok) {
      const sampleData = await sampleResponse.json()
      const fieldDesc = describeFieldsFromData(sampleData, sampleUrl)
      if (fieldDesc) {
        description = `${description}. ${fieldDesc}`
        console.error(`[api2aux-mcp] ${fieldDesc}`)
      }
    }
  } catch {
    // Non-fatal — enrichment is best-effort
    console.error(`[api2aux-mcp] Semantic enrichment skipped (fetch failed)`)
  }

  // Derive tool name from server name or URL hostname
  let toolName = 'fetch_api'
  if (serverName) {
    toolName = `fetch_${sanitizeParamName(serverName)}`
  } else {
    const hostParts = parsed.hostname.replace(/^(www|api)\./, '').split('.')
    if (hostParts.length > 0 && hostParts[0]) {
      toolName = `fetch_${sanitizeParamName(hostParts[0])}`
    }
  }

  server.registerTool(
    toolName,
    { description, inputSchema },
    async (args: Record<string, string | undefined>) => {
      const showDebug = debug || String(args.debug) === 'true'
      const noTruncate = fullResponse || String(args.full_response) === 'true'
      try {
        let url = baseUrl
        if (args.path) {
          url = url.replace(/\/$/, '') + '/' + args.path.replace(/^\//, '')
        }

        // Rebuild query string from defaults + overrides
        if (defaultParams.length > 0) {
          const params = new URLSearchParams()
          for (const param of defaultParams) {
            const value = args[param.sanitized] ?? param.defaultValue
            params.append(param.original, value)
          }
          url += '?' + params.toString()
        }

        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (bridgeAuth) {
          const authed = injectAuth(url, headers, bridgeAuth)
          url = authed.url
          Object.assign(headers, authed.headers)
        }

        const start = performance.now()
        const response = await fetch(url, { headers })
        const elapsedMs = Math.round(performance.now() - start)
        const data = await response.json()
        const responseText = formatResponse(data, noTruncate)

        const prefix = showDebug
          ? formatDebugInfo('GET', url, headers, response.status, responseText.length, elapsedMs)
          : ''

        return {
          content: [{
            type: 'text' as const,
            text: `${prefix}${responseText}`,
          }],
        }
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        }
      }
    }
  )

  console.error(`[api2aux-mcp] 1 tool registered (${toolName}) with ${paramCount} query parameters`)
}
