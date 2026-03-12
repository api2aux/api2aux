/**
 * Executes API calls for MCP tool invocations.
 * Delegates to api-invoke with throwOnHttpError: false so error
 * responses are returned as data (needed for MCP tools to show
 * error details to the LLM).
 */

import { executeOperation, withRetry, logging } from 'api-invoke'
import type { Operation, Auth, ExecutionResult, Middleware } from 'api-invoke'

export type { ExecutionResult }

const retryFetch = withRetry({ maxRetries: 2, initialDelayMs: 1000 })

export async function executeTool(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  auth?: Auth,
  options?: { debug?: boolean }
): Promise<ExecutionResult> {
  const middleware: Middleware[] = []
  if (options?.debug) {
    middleware.push(logging({ log: (msg) => console.error(`[api2aux-mcp] ${msg}`), prefix: 'api2aux' }))
  }

  return executeOperation(baseUrl, operation, args, {
    auth,
    throwOnHttpError: false,
    timeoutMs: 30000,
    fetch: retryFetch,
    middleware,
  })
}
