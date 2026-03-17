/**
 * Tag Proximity Signal — supplementary signal that boosts edges between related operations.
 *
 * Operations sharing tags or overlapping path prefixes are more likely to be related.
 * This signal creates weak edges that boost existing stronger signals.
 */

import type { InferenceOperation, OperationEdge, EdgeSignal } from '../types'

const SIGNAL_NAME = 'tag-proximity'
const SIGNAL_WEIGHT = 0.10

/** Calculate Jaccard similarity between two sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/** Get the first N path segments (without params). */
function getPathPrefix(path: string, segments: number): string {
  return path
    .split('/')
    .filter(Boolean)
    .filter(s => !s.startsWith('{'))
    .slice(0, segments)
    .join('/')
}

/**
 * Tag Proximity signal: create edges between operations that share tags or path prefixes.
 */
export function detectTagProximity(operations: InferenceOperation[]): OperationEdge[] {
  const edges: OperationEdge[] = []

  for (let i = 0; i < operations.length; i++) {
    const a = operations[i]!
    const aTags = new Set(a.tags)
    const aPrefix = getPathPrefix(a.path, 2)

    for (let j = i + 1; j < operations.length; j++) {
      const b = operations[j]!
      const bTags = new Set(b.tags)
      const bPrefix = getPathPrefix(b.path, 2)

      let score = 0

      // Tag overlap
      const tagSim = jaccard(aTags, bTags)
      if (tagSim > 0) score += tagSim * 0.6

      // Path prefix overlap
      if (aPrefix && bPrefix && aPrefix === bPrefix) {
        score += 0.4
      }

      if (score > 0.1) {
        const signal: EdgeSignal = {
          signal: SIGNAL_NAME,
          weight: SIGNAL_WEIGHT,
          matched: true,
          detail: `tags: ${tagSim.toFixed(2)}, path: ${aPrefix === bPrefix ? 'match' : 'no match'}`,
        }

        // Create bidirectional edges (separate signal copies to avoid shared mutation)
        edges.push({
          sourceId: a.id,
          targetId: b.id,
          bindings: [],
          score: score * SIGNAL_WEIGHT,
          signals: [{ ...signal }],
        })
        edges.push({
          sourceId: b.id,
          targetId: a.id,
          bindings: [],
          score: score * SIGNAL_WEIGHT,
          signals: [{ ...signal }],
        })
      }
    }
  }

  return edges
}
