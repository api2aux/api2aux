/**
 * MCP Server that registers API operations as tools.
 * Accepts an OpenAPI spec URL or raw API URL and creates tools dynamically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { ParsedAPI, ExecutionResult, Auth } from 'api-invoke'
import { parseRawUrl, parseGraphQLSchema, buildRequest, hasGraphQLErrors, getGraphQLErrors, ApiInvokeError, ErrorKind } from 'api-invoke'
import { generateTools } from './tool-generator'
import type { GeneratedTool } from './tool-generator'
import { enrichTools } from './semantic-enrichment'
import { executeTool, executeToolStream } from './tool-executor'
import type { SSEEvent } from './tool-executor'
import { formatResponse } from './response-formatter'
import type { ServerConfig } from './types'

/**
 * Parse auth config from CLI options.
 * Supports combining multiple auth schemes (e.g., --token + --api-key).
 */
function parseAuth(config: ServerConfig): Auth | Auth[] | undefined {
  const auths: Auth[] = []

  if (config.token) {
    auths.push({ type: 'bearer', token: config.token })
  }
  if (config.header) {
    const colonIdx = config.header.indexOf(':')
    if (colonIdx > 0) {
      auths.push({
        type: 'apiKey',
        location: 'header',
        name: config.header.slice(0, colonIdx).trim(),
        value: config.header.slice(colonIdx + 1).trim(),
      })
    }
  }
  if (config.apiKey) {
    const eqIdx = config.apiKey.indexOf('=')
    if (eqIdx > 0) {
      auths.push({
        type: 'apiKey',
        location: 'query',
        name: config.apiKey.slice(0, eqIdx),
        value: config.apiKey.slice(eqIdx + 1),
      })
    }
  }
  if (config.cookie) {
    const eqIdx = config.cookie.indexOf('=')
    if (eqIdx > 0) {
      auths.push({
        type: 'cookie',
        name: config.cookie.slice(0, eqIdx),
        value: config.cookie.slice(eqIdx + 1),
      })
    }
  }

  if (auths.length === 0) return undefined
  return auths.length === 1 ? auths[0] : auths
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
  } else if (config.graphqlUrl) {
    // GraphQL mode: introspect and generate tools for queries/mutations
    await registerGraphQLTools(server, config.graphqlUrl, auth, config.name, debug, fullResponse)
  } else if (config.apiUrl) {
    // Raw API mode: register a single fetch tool
    await registerRawAPITool(server, config.apiUrl, auth, config.name, debug, fullResponse)
  } else {
    throw new Error('One of --openapi, --graphql, or --api must be specified')
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
  bridgeAuth: Auth | Auth[] | undefined,
  debug: boolean,
  fullResponse: boolean
) {
  return async (args: Record<string, unknown>) => {
    if (args.dry_run === true) {
      const req = buildRequest(baseUrl, tool.operation, args, { auth: bridgeAuth })
      const maskedH = maskHeaders(req.headers)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ method: req.method, url: req.url, headers: maskedH, body: req.body }, null, 2),
        }],
      }
    }
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

/** Default max events to collect from an SSE stream before stopping. */
const DEFAULT_MAX_SSE_EVENTS = 50

/**
 * Format collected SSE events as text for an MCP tool response.
 */
function formatSSEEvents(events: SSEEvent[], elapsedMs: number, truncated: boolean): string {
  const lines: string[] = []
  for (const event of events) {
    const prefix = event.event && event.event !== 'message' ? `[${event.event}] ` : ''
    lines.push(`${prefix}${event.data}`)
  }
  const suffix = truncated
    ? `\n\n--- Stream truncated after ${events.length} events (${elapsedMs}ms) ---`
    : `\n\n--- Stream ended: ${events.length} events (${elapsedMs}ms) ---`
  return lines.join('\n') + suffix
}

/**
 * Create a tool handler for SSE/streaming operations.
 * Internally consumes the stream and returns collected events as text,
 * since MCP tools cannot return streaming responses.
 */
function createStreamingToolHandler(
  baseUrl: string,
  tool: GeneratedTool,
  bridgeAuth: Auth | Auth[] | undefined,
  debug: boolean,
  fullResponse: boolean
) {
  return async (args: Record<string, unknown>) => {
    if (args.dry_run === true) {
      const req = buildRequest(baseUrl, tool.operation, args, { auth: bridgeAuth })
      const maskedH = maskHeaders(req.headers)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ method: req.method, url: req.url, headers: maskedH, body: req.body }, null, 2),
        }],
      }
    }
    const showDebug = debug || args.debug === true
    const maxEvents = fullResponse || args.full_response === true
      ? Infinity
      : DEFAULT_MAX_SSE_EVENTS
    try {
      const result = await executeToolStream(baseUrl, tool.operation, args, bridgeAuth, { debug: showDebug })
      const events: SSEEvent[] = []
      let truncated = false

      for await (const event of result.stream) {
        events.push(event)
        if (events.length >= maxEvents) {
          truncated = true
          break
        }
      }

      const responseText = formatSSEEvents(events, result.elapsedMs, truncated)

      let prefix = ''
      if (showDebug) {
        const { method, url, headers } = result.request
        const maskedH = maskHeaders(headers)
        const headerStr = Object.entries(maskedH).map(([k, v]) => `${k}: ${v}`).join(', ')
        prefix = [
          `[DEBUG] ${method} ${url}`,
          `[DEBUG] Headers: ${headerStr}`,
          `[DEBUG] Status: ${result.status} | Events: ${events.length} | TTFB: ${result.elapsedMs}ms`,
          '',
        ].join('\n')
      }

      return {
        content: [{
          type: 'text' as const,
          text: `${prefix}${responseText}`,
        }],
      }
    } catch (err) {
      if (err instanceof ApiInvokeError) {
        const label = err.kind === ErrorKind.RATE_LIMIT ? 'Rate limited'
          : err.kind === ErrorKind.AUTH ? 'Authentication failed'
          : err.kind === ErrorKind.TIMEOUT ? 'Request timed out'
          : err.kind === ErrorKind.NETWORK ? 'Network error'
          : 'Stream failed'
        const suggestion = err.suggestion ? ` Suggestion: ${err.suggestion}` : ''
        return {
          content: [{
            type: 'text' as const,
            text: `${label}: ${err.message}${suggestion}`,
          }],
          isError: true,
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Stream failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      }
    }
  }
}

/**
 * Check if an operation produces an SSE/event-stream response.
 */
function isStreamingOperation(tool: GeneratedTool): boolean {
  const ct = tool.operation.responseContentType
  return ct === 'text/event-stream' || ct === 'text/event-stream; charset=utf-8'
}

/**
 * Register tools on an MCP server from generated tool definitions.
 */
function registerToolsOnServer(
  server: McpServer,
  tools: GeneratedTool[],
  baseUrl: string,
  bridgeAuth: Auth | Auth[] | undefined,
  debug: boolean,
  fullResponse: boolean
): void {
  for (const tool of tools) {
    const toolSchema = {
      ...tool.inputSchema,
      debug: z.boolean().optional().describe('Set to true to see the request URL, headers, and timing'),
      full_response: z.boolean().optional().describe('Set to true to disable truncation and return the full response'),
      dry_run: z.boolean().optional().describe('Set to true to preview the request without executing it'),
    }

    const hasInputs = Object.keys(tool.inputSchema).length > 0
    const handler = isStreamingOperation(tool)
      ? createStreamingToolHandler(baseUrl, tool, bridgeAuth, debug, fullResponse)
      : createToolHandler(baseUrl, tool, bridgeAuth, debug, fullResponse)

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
  auth: Auth | Auth[] | undefined,
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
  const bridgeAuth = auth

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
 * Create a tool handler for GraphQL operations.
 * Checks for GraphQL-specific errors (HTTP 200 with errors in response body).
 */
function createGraphQLToolHandler(
  baseUrl: string,
  tool: GeneratedTool,
  bridgeAuth: Auth | Auth[] | undefined,
  debug: boolean,
  fullResponse: boolean
) {
  return async (args: Record<string, unknown>) => {
    if (args.dry_run === true) {
      const req = buildRequest(baseUrl, tool.operation, args, { auth: bridgeAuth })
      const maskedH = maskHeaders(req.headers)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ method: req.method, url: req.url, headers: maskedH, body: req.body }, null, 2),
        }],
      }
    }
    const showDebug = debug || args.debug === true
    const noTruncate = fullResponse || args.full_response === true
    try {
      const result = await executeTool(baseUrl, tool.operation, args, bridgeAuth, { debug: showDebug })
      const prefix = showDebug
        ? formatDebugInfo(result, JSON.stringify(result.data).length)
        : ''

      // Check for GraphQL errors (HTTP 200 but errors in response)
      if (hasGraphQLErrors(result)) {
        const errors = getGraphQLErrors(result)
        const errorMessages = errors.map(e => e.message).join('; ')
        // If there's also data, return both (partial error)
        const data = (result.data as Record<string, unknown>)?.data
        if (data) {
          const dataText = formatResponse(data, noTruncate)
          return {
            content: [{
              type: 'text' as const,
              text: `${prefix}GraphQL partial errors: ${errorMessages}\n\nData:\n${dataText}`,
            }],
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: `${prefix}GraphQL errors: ${errorMessages}`,
          }],
          isError: true,
        }
      }

      if (result.status >= 400) {
        const label = result.errorKind === ErrorKind.RATE_LIMIT ? 'Rate limited'
          : result.errorKind === ErrorKind.AUTH ? 'Auth error'
          : `API error ${result.status}`
        const responseText = formatResponse(result.data, noTruncate)
        return {
          content: [{
            type: 'text' as const,
            text: `${prefix}${label}: ${responseText}`,
          }],
          isError: true,
        }
      }

      // Extract just the data field for cleaner output
      const data = (result.data as Record<string, unknown>)?.data ?? result.data
      const responseText = formatResponse(data, noTruncate)
      return {
        content: [{
          type: 'text' as const,
          text: `${prefix}${responseText}`,
        }],
      }
    } catch (err) {
      if (err instanceof ApiInvokeError) {
        const label = err.kind === ErrorKind.RATE_LIMIT ? 'Rate limited'
          : err.kind === ErrorKind.AUTH ? 'Authentication failed'
          : err.kind === ErrorKind.TIMEOUT ? 'Request timed out'
          : err.kind === ErrorKind.NETWORK ? 'Network error'
          : 'Request failed'
        const suggestion = err.suggestion ? ` Suggestion: ${err.suggestion}` : ''
        return {
          content: [{
            type: 'text' as const,
            text: `${label}: ${err.message}${suggestion}`,
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
 * Register tools on an MCP server for GraphQL operations.
 * Uses the GraphQL-specific handler that checks for GraphQL errors.
 */
function registerGraphQLToolsOnServer(
  server: McpServer,
  tools: GeneratedTool[],
  baseUrl: string,
  bridgeAuth: Auth | Auth[] | undefined,
  debug: boolean,
  fullResponse: boolean
): void {
  for (const tool of tools) {
    const toolSchema = {
      ...tool.inputSchema,
      debug: z.boolean().optional().describe('Set to true to see the request URL, headers, and timing'),
      full_response: z.boolean().optional().describe('Set to true to disable truncation and return the full response'),
      dry_run: z.boolean().optional().describe('Set to true to preview the request without executing it'),
    }

    const hasInputs = Object.keys(tool.inputSchema).length > 0
    const handler = createGraphQLToolHandler(baseUrl, tool, bridgeAuth, debug, fullResponse)

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
 * Parse a GraphQL endpoint via introspection and register each query/mutation as an MCP tool.
 */
async function registerGraphQLTools(
  server: McpServer,
  graphqlUrl: string,
  auth: Auth | Auth[] | undefined,
  serverName: string | undefined,
  debug: boolean,
  fullResponse: boolean
): Promise<void> {
  console.error(`[api2aux-mcp] GraphQL mode: ${graphqlUrl}`)

  let spec: ParsedAPI
  try {
    spec = await parseGraphQLSchema(graphqlUrl)
  } catch (err) {
    throw new Error(`Failed to introspect GraphQL at ${graphqlUrl}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const baseUrl = spec.baseUrl
  const rawTools = generateTools(spec.operations)

  console.error(`[api2aux-mcp] Parsed "${spec.title}" (${spec.specFormat})`)
  console.error(`[api2aux-mcp] Base URL: ${baseUrl}`)
  console.error(`[api2aux-mcp] ${rawTools.length} operations discovered`)

  // Override names with server name prefix if provided
  if (serverName) {
    const prefix = sanitizeName(serverName)
    for (const tool of rawTools) {
      tool.name = `${prefix}_${tool.name}`
    }
  }

  console.error(`[api2aux-mcp] Registering ${rawTools.length} tools...`)

  registerGraphQLToolsOnServer(server, rawTools, baseUrl, auth, debug, fullResponse)

  console.error(`[api2aux-mcp] ${rawTools.length} tools registered`)
}

/**
 * Register tools for a raw API URL using parseRawUrl().
 * Uses the same generateTools → enrichTools → register pipeline as OpenAPI mode.
 */
async function registerRawAPITool(
  server: McpServer,
  apiUrl: string,
  auth: Auth | Auth[] | undefined,
  serverName: string | undefined,
  debug: boolean,
  fullResponse: boolean
): Promise<void> {
  console.error(`[api2aux-mcp] Raw API mode: ${apiUrl}`)

  const spec = parseRawUrl(apiUrl)
  const baseUrl = spec.baseUrl
  const bridgeAuth = auth
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
