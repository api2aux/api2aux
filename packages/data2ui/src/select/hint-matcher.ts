/**
 * Matches UI component hints from enrichment plugins against field paths.
 *
 * Hints use glob-like patterns:
 * - `*.price` matches any path ending in `.price`
 * - `$.items[].thumbnail` matches that exact path
 * - `*.items[].name` matches paths ending in `items[].name`
 */

import type { UIComponentHint } from '@api2aux/semantic-analysis'
import type { ComponentSelection } from './types'
import { SelectionReason } from '../types'
import { SMART_DEFAULT_THRESHOLD } from './index'

/**
 * Find the best matching UI hint for a given path.
 * Returns a ComponentSelection if a hint matches with sufficient confidence, null otherwise.
 */
export function matchUIHint(
  path: string,
  hints: UIComponentHint[] | undefined,
): ComponentSelection | null {
  if (!hints || hints.length === 0) return null

  let bestMatch: UIComponentHint | null = null

  for (const hint of hints) {
    if (hint.confidence < SMART_DEFAULT_THRESHOLD) continue
    if (!matchesPattern(path, hint.fieldPattern)) continue

    if (!bestMatch || hint.confidence > bestMatch.confidence) {
      bestMatch = hint
    }
  }

  if (!bestMatch) return null

  return {
    componentType: bestMatch.suggestedComponent,
    confidence: bestMatch.confidence,
    reason: SelectionReason.PluginHint,
  }
}

/**
 * Match a JSON path against a glob-like field pattern.
 *
 * - `*.field` matches any path ending in `.field`
 * - `exact.path` matches if path ends with it
 * - Literal path matches exactly
 */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern === path) return true

  if (pattern.startsWith('*.')) {
    // Wildcard prefix: match any path ending in the suffix
    const suffix = pattern.slice(1) // keep the dot: '.price'
    return path.endsWith(suffix)
  }

  // Check if the pattern matches the end of the path
  return path.endsWith(pattern) || path.endsWith('.' + pattern)
}
