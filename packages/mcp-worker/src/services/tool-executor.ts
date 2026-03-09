/**
 * Executes API calls for MCP tool invocations.
 * Delegates to api-bridge-rt with throwOnHttpError: false so error
 * responses are returned as data (needed for MCP tools to show
 * error details to the LLM).
 */

import { executeOperation } from 'api-bridge-rt'
import type { Operation, Auth, ExecutionResult } from 'api-bridge-rt'

export type { ExecutionResult }

export async function executeTool(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  auth?: Auth
): Promise<ExecutionResult> {
  return executeOperation(baseUrl, operation, args, { auth, throwOnHttpError: false })
}
