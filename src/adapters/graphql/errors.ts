/**
 * GraphQL error detection and handling utilities.
 * GraphQL APIs return HTTP 200 even on errors — these helpers inspect the response body.
 */

import type { ExecutionResult } from '../../core/types'
import { graphqlError } from '../../core/errors'

/** A single GraphQL error from the response `errors` array. */
export interface GraphQLError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: Array<string | number>
  extensions?: Record<string, unknown>
}

/** Check if an ExecutionResult contains GraphQL errors. Returns true for both total and partial errors. Use {@link throwOnGraphQLErrors} to throw only on total failures (when `data` is null). */
export function hasGraphQLErrors(result: ExecutionResult): boolean {
  const body = result.data as Record<string, unknown> | null
  return body != null && Array.isArray(body.errors) && body.errors.length > 0
}

/** Extract GraphQL errors from an ExecutionResult. Returns empty array if none. */
export function getGraphQLErrors(result: ExecutionResult): GraphQLError[] {
  const body = result.data as Record<string, unknown> | null
  if (body != null && Array.isArray(body.errors)) return body.errors as GraphQLError[]
  return []
}

/**
 * Throw if the result has GraphQL errors and no data (total failure).
 * Partial errors (data + errors both present) do not throw — the caller decides how to handle them.
 */
export function throwOnGraphQLErrors(result: ExecutionResult): void {
  const body = result.data as Record<string, unknown> | null
  if (body == null || !Array.isArray(body.errors) || body.errors.length === 0) return
  if (body.data != null) return // Partial error — data is present

  const errors = body.errors as GraphQLError[]
  const messages = errors.map(e => e.message).join('; ')
  throw graphqlError(messages, result.status, body)
}
