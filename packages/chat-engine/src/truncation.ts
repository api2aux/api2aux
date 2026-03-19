/**
 * Utilities for truncating and summarizing tool results
 * before feeding them back to the LLM.
 */

import { TRUNCATION_LIMIT } from './defaults'

/**
 * Truncate a tool result's JSON serialization to a character limit.
 * The result may be invalid JSON if truncated mid-value; a [truncated] marker
 * is appended so the LLM knows the data is incomplete.
 */
export function truncateToolResult(data: unknown, limit: number = TRUNCATION_LIMIT): string {
  let json: string
  try {
    json = JSON.stringify(data)
  } catch {
    return '[Unserializable tool result]'
  }
  if (json.length <= limit) return json
  return json.slice(0, limit) + '... [truncated]'
}

/**
 * Generate a compact text summary for a tool result shown in the chat.
 * Includes tool name, args, and a count of the returned data items.
 */
export function summarizeToolResult(
  data: unknown,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const argStr = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => {
      try {
        return `${k}=${JSON.stringify(v)}`
      } catch {
        return `${k}=[unserializable]`
      }
    })
    .join(', ')

  let countInfo = ''
  if (Array.isArray(data)) {
    countInfo = ` → ${data.length} item${data.length !== 1 ? 's' : ''}`
  } else if (data && typeof data === 'object') {
    countInfo = ` → ${Object.keys(data).length} field${Object.keys(data).length !== 1 ? 's' : ''}`
  }

  return `${toolName}(${argStr})${countInfo}`
}
