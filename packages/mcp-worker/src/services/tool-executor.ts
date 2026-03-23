/**
 * Executes API calls for MCP tool invocations.
 * executeTool delegates to api-invoke with throwOnHttpError: false so error
 * responses are returned as data (needed for MCP tools to show error details to the LLM).
 * executeToolStream throws on HTTP errors.
 */

import { executeOperation, executeOperationStream, withRetry } from '@api2aux/api-invoke'
import type { Operation, Auth, ExecutionResult, StreamingExecutionResult } from '@api2aux/api-invoke'

export type { ExecutionResult, StreamingExecutionResult }

const retryFetch = withRetry({ maxRetries: 2, initialDelayMs: 1000 })

export async function executeTool(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  auth?: Auth
): Promise<ExecutionResult> {
  return executeOperation(baseUrl, operation, args, {
    auth,
    throwOnHttpError: false,
    timeoutMs: 30000,
    fetch: retryFetch,
  })
}

/**
 * Execute a streaming API call for a tool invocation.
 * Returns a StreamingExecutionResult with an async iterable of SSE events.
 */
export async function executeToolStream(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  auth?: Auth
): Promise<StreamingExecutionResult> {
  return executeOperationStream(baseUrl, operation, args, {
    auth,
    timeoutMs: 120000,
    fetch: retryFetch,
  })
}
