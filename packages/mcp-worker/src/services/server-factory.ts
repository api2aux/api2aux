/**
 * Creates a stateless McpServer instance from a tenant config.
 * Rebuilds Zod tool schemas from stored operations and registers
 * handlers that execute API calls with credential forwarding.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { TenantConfig, AuthConfig } from '../types'
import { toAuth } from '../types'
import { generateTools } from './tool-generator'
import { executeTool } from './tool-executor'
import { formatResponse } from './response-formatter'

export function createWorkerServer(config: TenantConfig, auth: AuthConfig): McpServer {
  const server = new McpServer({
    name: `api2aux-${config.name}`,
    version: '0.1.0',
  })

  const tools = generateTools(config.operations)
  const bridgeAuth = toAuth(auth)

  for (const tool of tools) {
    const toolSchema = {
      ...tool.inputSchema,
      full_response: z.boolean().optional().describe('Set to true to disable truncation and return the full response'),
    }

    const hasInputs = Object.keys(tool.inputSchema).length > 0

    const handler = async (args: Record<string, unknown>) => {
      const noTruncate = args.full_response === true
      try {
        const result = await executeTool(config.baseUrl, tool.operation, args, bridgeAuth)
        const responseText = formatResponse(result.data, noTruncate)

        if (result.status >= 400) {
          return {
            content: [{ type: 'text' as const, text: `API error ${result.status}: ${responseText}` }],
            isError: true,
          }
        }

        return {
          content: [{ type: 'text' as const, text: responseText }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Request failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }

    if (hasInputs) {
      server.registerTool(tool.name, { description: tool.description, inputSchema: toolSchema }, handler)
    } else {
      server.registerTool(tool.name, { description: tool.description, inputSchema: { full_response: toolSchema.full_response } }, handler)
    }
  }

  return server
}
