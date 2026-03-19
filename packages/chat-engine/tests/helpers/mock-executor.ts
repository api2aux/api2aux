/**
 * Reusable mock executor for functional tests.
 * Returns canned responses keyed by tool name.
 */

import type { ToolExecutorFn } from '../../src/types'

/**
 * Create a mock executor that returns canned responses.
 *
 * @param responses - Map of toolName → response data.
 *   Can also be a function (toolName, args) → data for dynamic responses.
 */
export function createMockExecutor(
  responses: Record<string, unknown> | ((toolName: string, args: Record<string, unknown>) => unknown),
): ToolExecutorFn {
  return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    if (typeof responses === 'function') {
      return responses(toolName, args)
    }

    if (toolName in responses) {
      return responses[toolName]
    }

    throw new Error(`Unknown tool: ${toolName}`)
  }
}

/**
 * Create a mock executor that throws for specific tools.
 * Useful for testing error recovery.
 */
export function createFailingExecutor(
  failingTools: Record<string, string>,
  fallback: Record<string, unknown> = {},
): ToolExecutorFn {
  return async (toolName: string, _args: Record<string, unknown>): Promise<unknown> => {
    if (toolName in failingTools) {
      throw new Error(failingTools[toolName])
    }
    if (toolName in fallback) {
      return fallback[toolName]
    }
    return { result: 'ok' }
  }
}
