/**
 * Value extractor — extracts matchable values from API response data.
 *
 * Walks JSON to a configurable depth, keeping strings and numbers that
 * look like identifiers (slugs, indexes, short codes). Skips noise:
 * URLs, dates, UUIDs, booleans, long text.
 */

import type { RuntimeProbeValue } from '@api2aux/workflow-inference'

/** Regex patterns for values to skip. */
const SKIP_PATTERNS = [
  /^https?:\/\//i,           // URLs
  /^\d{4}-\d{2}-\d{2}/,     // ISO dates
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUIDs
  /^(true|false)$/i,         // Booleans as strings
  /^\s*$/,                   // Whitespace
]

/** Check if a string value looks like an identifier worth matching. */
function isIdentifierLike(value: string): boolean {
  if (value.length < 1 || value.length > 50) return false
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(value)) return false
  }
  return true
}

/** Check if a number value is worth matching. */
function isUsefulNumber(value: number): boolean {
  if (!Number.isFinite(value)) return false
  if (!Number.isInteger(value)) return false
  if (value < 2) return false // Skip 0 and 1 — too common
  return true
}

/**
 * Extract matchable values from an API response.
 * Walks JSON to maxDepth, returns identifiers and useful numbers.
 */
export function extractProbeValues(
  data: unknown,
  maxDepth = 3,
  maxValues = 200,
): RuntimeProbeValue[] {
  const values: RuntimeProbeValue[] = []

  function walk(obj: unknown, path: string, depth: number): void {
    if (values.length >= maxValues) return
    if (depth > maxDepth) return

    if (obj === null || obj === undefined) return

    if (typeof obj === 'string') {
      if (isIdentifierLike(obj)) {
        values.push({ fieldPath: path, value: obj, type: 'string' })
      }
      return
    }

    if (typeof obj === 'number') {
      if (isUsefulNumber(obj)) {
        values.push({ fieldPath: path, value: obj, type: 'number' })
      }
      return
    }

    if (Array.isArray(obj)) {
      // For arrays, sample first few items
      const limit = Math.min(obj.length, 5)
      for (let i = 0; i < limit; i++) {
        walk(obj[i], `${path}[${i}]`, depth + 1)
      }
      return
    }

    if (typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key
        walk(val, childPath, depth + 1)
      }
    }
  }

  walk(data, '', 0)
  return values
}
