/**
 * Utilities for truncating and summarizing tool results
 * before feeding them back to the LLM.
 */

import { TRUNCATION_LIMIT } from './defaults'

/**
 * Truncate a tool result to fit within the LLM context window.
 * Serializes to JSON and cuts at the character limit.
 */
export function truncateToolResult(data: unknown, limit: number = TRUNCATION_LIMIT): string {
  return JSON.stringify(data).slice(0, limit)
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
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')

  let countInfo = ''
  if (Array.isArray(data)) {
    countInfo = ` → ${data.length} item${data.length !== 1 ? 's' : ''}`
  } else if (data && typeof data === 'object') {
    countInfo = ` → ${Object.keys(data).length} field${Object.keys(data).length !== 1 ? 's' : ''}`
  }

  return `${toolName}(${argStr})${countInfo}`
}
