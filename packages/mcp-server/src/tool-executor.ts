/**
 * Executes API calls for MCP tool invocations.
 * executeTool delegates to api-invoke with throwOnHttpError: false so error
 * responses are returned as data (needed for MCP tools to show error details to the LLM).
 * executeToolStream throws on HTTP errors.
 */

import { executeOperation, executeOperationStream, withRetry, logging } from '@api2aux/api-invoke'
import type { Operation, Auth, ExecutionResult, StreamingExecutionResult, SSEEvent, Middleware } from '@api2aux/api-invoke'

export type { ExecutionResult, StreamingExecutionResult, SSEEvent }

const retryFetch = withRetry({ maxRetries: 2, initialDelayMs: 1000 })

export async function executeTool(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  auth?: Auth | Auth[],
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

/**
 * Execute a streaming API call for an MCP tool invocation.
 * Returns a StreamingExecutionResult with an async iterable of SSE events.
 * Unlike executeTool, streaming always throws on HTTP errors.
 */
export async function executeToolStream(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  auth?: Auth | Auth[],
  options?: { debug?: boolean }
): Promise<StreamingExecutionResult> {
  const middleware: Middleware[] = []
  if (options?.debug) {
    middleware.push(logging({ log: (msg) => console.error(`[api2aux-mcp] ${msg}`), prefix: 'api2aux' }))
  }

  return executeOperationStream(baseUrl, operation, args, {
    auth,
    timeoutMs: 120000,
    fetch: retryFetch,
    middleware,
  })
}
