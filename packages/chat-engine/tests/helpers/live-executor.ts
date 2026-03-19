/**
 * Live executor for functional tests that hit real APIs.
 * Wraps api-invoke's executeOperation.
 */

import type { ToolExecutorFn } from '../../src/types'
import { executeOperation } from 'api-invoke'
import { generateToolName } from '@api2aux/tool-utils'
import type { ParsedAPI } from '@api2aux/semantic-analysis'

/**
 * Create an executor that makes real HTTP calls using api-invoke.
 * Maps tool names back to operations via generateToolName.
 */
export function createLiveExecutor(spec: ParsedAPI): ToolExecutorFn {
  return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const operation = spec.operations.find(op => generateToolName(op) === toolName)

    if (!operation) {
      throw new Error(`Operation not found for tool: ${toolName}`)
    }

    const result = await executeOperation(spec.baseUrl, operation, args, {
      timeoutMs: 10000,
    })

    return result.data
  }
}

/**
 * Retry helper for live tests. Retries on network errors, skips on persistent failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const msg = lastError.message.toLowerCase()
      const isNetworkError = msg.includes('fetch') || msg.includes('econnrefused') ||
        msg.includes('timeout') || msg.includes('enotfound') || msg.includes('network')

      if (!isNetworkError) throw lastError
      // Wait briefly before retry
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  throw lastError!
}
