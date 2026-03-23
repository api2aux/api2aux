/**
 * Focus reduction strategies.
 *
 * Reduces per-item data SIZE before sending to the focus/merge LLM,
 * while preserving ALL items in the array. Currently supports:
 *
 * - truncate-values: keep all fields, truncate long values (default)
 */

import type { ToolResultEntry, FocusReduction } from './types'

// ── Public API ──

/**
 * Reduce each tool result's data for the focus/merge LLM.
 * Preserves all items; reduces per-item size via the chosen strategy.
 */
export async function reduceToolResultsForFocus(
  toolResults: ToolResultEntry[],
  _query: string,
  strategy: FocusReduction,
  _embedFn?: unknown,
  _llmText?: unknown,
  onWarning?: (message: string) => void,
): Promise<ToolResultEntry[]> {
  const reduced: ToolResultEntry[] = []

  for (const result of toolResults) {
    let reducedData: unknown
    try {
      reducedData = reduceData(result.data, strategy)
    } catch (err) {
      // Distinguish programming errors from expected failures
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof TypeError || err instanceof ReferenceError) {
        console.error('[chat-engine] Focus reduction hit unexpected error (possible bug):', err)
      } else {
        console.warn('[chat-engine] Focus reduction failed, using raw data:', msg)
      }
      onWarning?.(`Focus reduction (${strategy}) failed, showing raw data: ${msg}`)
      reducedData = result.data
    }
    reduced.push(reducedData !== result.data ? { ...result, data: reducedData } : result)
  }

  return reduced
}

/** Route to the correct strategy for a data value. */
function reduceData(
  data: unknown,
  strategy: FocusReduction,
): unknown {
  switch (strategy) {
    case 'truncate-values':
      return truncateValues(data)

    default:
      return truncateValues(data)
  }
}

// ── truncate-values strategy ──

const MAX_STRING_LENGTH = 200
const MAX_ARRAY_ITEMS = 5

/** Keep all fields, truncate long values. */
export function truncateValues(data: unknown): unknown {
  return truncateValuesInternal(data, 0)
}

function truncateValuesInternal(data: unknown, depth: number): unknown {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return truncateScalar(data)

  if (Array.isArray(data)) {
    // Top-level arrays: preserve all items, truncate each
    return data.map(item => truncateValuesInternal(item, depth + 1))
  }

  const obj = data as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value
      continue
    }

    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH && !looksLikeUrl(value)) {
        result[key] = value.slice(0, MAX_STRING_LENGTH) + '...'
      } else {
        result[key] = value
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = truncateArray(key, value, depth)
    } else if (typeof value === 'object') {
      result[key] = truncateValuesInternal(value, depth + 1)
    }
  }

  return result
}

function truncateScalar(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return value.slice(0, MAX_STRING_LENGTH) + '...'
  }
  return value
}

function truncateArray(key: string, arr: unknown[], depth: number): unknown {
  if (arr.length === 0) return arr

  // Array of objects: at top level (depth 0), truncate each item's values.
  // At deeper levels (nested arrays like reviews), summarize to a count.
  if (typeof arr[0] === 'object' && arr[0] !== null && !Array.isArray(arr[0])) {
    if (depth === 0) {
      // Top-level data array — preserve every item, truncate each item's values
      return arr.map(item => truncateValuesInternal(item, depth + 1))
    }
    return summarizeObjectArray(key, arr)
  }

  // Array of strings → keep first N
  if (typeof arr[0] === 'string') {
    if (arr.length <= MAX_ARRAY_ITEMS) return arr
    return [...arr.slice(0, MAX_ARRAY_ITEMS), `...and ${arr.length - MAX_ARRAY_ITEMS} more`]
  }

  // Other arrays → keep first N
  if (arr.length <= MAX_ARRAY_ITEMS) return arr
  return [...arr.slice(0, MAX_ARRAY_ITEMS), `...and ${arr.length - MAX_ARRAY_ITEMS} more`]
}

function summarizeObjectArray(key: string, arr: unknown[]): string {
  // Find a numeric field for averaging (like rating)
  const firstItem = arr[0] as Record<string, unknown>
  for (const [fieldName, fieldValue] of Object.entries(firstItem)) {
    if (typeof fieldValue === 'number' && !fieldName.toLowerCase().includes('id')) {
      const values = arr
        .map(item => (item as Record<string, unknown>)[fieldName])
        .filter((v): v is number => typeof v === 'number')
      if (values.length > 0) {
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length
        return `${arr.length} ${key}, avg ${fieldName} ${avg.toFixed(1)}`
      }
    }
  }
  return `${arr.length} ${key}`
}

// ── Shared utilities ──

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('data:')
}
