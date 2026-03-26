/**
 * Name Similarity Signal — weakest supplementary signal.
 *
 * Uses Jaro-Winkler distance to find response fields whose names
 * are very similar to target parameters. Only emits edges for
 * high similarity (> 0.85) to avoid noise.
 */

import { BuiltInSignal } from '../types'
import type { InferenceOperation, OperationEdge, DataBinding, EdgeSignal } from '../types'
import { isPaginationParam } from './param-filter'

const SIGNAL_NAME = BuiltInSignal.NameSimilarity
const SIGNAL_WEIGHT = 0.05
const SIMILARITY_THRESHOLD = 0.85

/**
 * Jaro similarity between two strings.
 */
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0
  if (s1.length === 0 || s2.length === 0) return 0.0

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  const s1Matches = new Array<boolean>(s1.length).fill(false)
  const s2Matches = new Array<boolean>(s2.length).fill(false)

  let matches = 0
  let transpositions = 0

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist)
    const end = Math.min(i + maxDist + 1, s2.length)

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0.0

  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  return (
    matches / s1.length +
    matches / s2.length +
    (matches - transpositions / 2) / matches
  ) / 3
}

/**
 * Jaro-Winkler similarity (boosts common prefixes).
 */
function jaroWinkler(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2)

  // Common prefix length (max 4)
  let prefix = 0
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }

  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * Name Similarity signal: find response fields with very similar names to target params.
 */
export function detectNameSimilarity(operations: InferenceOperation[]): OperationEdge[] {
  const edges: OperationEdge[] = []

  for (const source of operations) {
    if (source.responseFields.length === 0) continue

    for (const target of operations) {
      if (source.id === target.id) continue

      const targetParams = target.parameters.filter(
        p => (p.in === 'path' || p.in === 'query') && !isPaginationParam(p.name)
      )
      if (targetParams.length === 0) continue

      const bindings: DataBinding[] = []

      for (const field of source.responseFields) {
        for (const param of targetParams) {
          // Normalize to lowercase for comparison
          const similarity = jaroWinkler(
            field.name.toLowerCase(),
            param.name.toLowerCase()
          )

          if (similarity >= SIMILARITY_THRESHOLD && field.name.toLowerCase() !== param.name.toLowerCase()) {
            // Only add if not already an exact/case-insensitive match (handled by id-pattern)
            bindings.push({
              sourceField: field.path,
              targetParam: param.name,
              targetParamIn: param.in,
              confidence: similarity,
            })
          }
        }
      }

      if (bindings.length > 0) {
        const bestSimilarity = Math.max(...bindings.map(b => b.confidence))
        const signal: EdgeSignal = {
          signal: SIGNAL_NAME,
          weight: SIGNAL_WEIGHT,
          matched: true,
          detail: `${bindings.length} similar name pairs (best: ${bestSimilarity.toFixed(2)})`,
        }

        edges.push({
          sourceId: source.id,
          targetId: target.id,
          bindings,
          score: bestSimilarity * SIGNAL_WEIGHT,
          signals: [signal],
        })
      }
    }
  }

  return edges
}

// Export for testing
export { jaroWinkler, jaroSimilarity }
