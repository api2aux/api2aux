/**
 * ID Pattern Signal — the strongest signal (~60-70% of real chains).
 *
 * Detects when a response field from operation A matches a path/query parameter
 * in operation B. For example, if A returns { userId: "123" } and B has a
 * path parameter {userId}, they can chain.
 *
 * Scoring:
 * - Exact name match: 0.9
 * - Case-insensitive match: 0.8
 * - Suffix match (e.g. response "userId" → param "user_id"): 0.7
 */

import type { InferenceOperation, OperationEdge, DataBinding, EdgeSignal } from '../types'

const SIGNAL_NAME = 'id-pattern'
const SIGNAL_WEIGHT = 0.35

/** Normalize a field/param name for comparison: lowercase, strip separators. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

/** Check if a field name looks like an ID field. */
function isIdLike(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'id' || lower === '_id' ||
    lower.endsWith('id') || lower.endsWith('_id') || lower.endsWith('Id') ||
    lower.endsWith('uuid') || lower.endsWith('slug') ||
    lower.endsWith('key') || lower.endsWith('code')
}

/**
 * ID Pattern signal: match response fields to path/query params across operations.
 */
export function detectIdPatterns(operations: InferenceOperation[]): OperationEdge[] {
  const edges: OperationEdge[] = []

  for (const source of operations) {
    if (source.responseFields.length === 0) continue

    for (const target of operations) {
      if (source.id === target.id) continue

      // Only match against path and required query params
      const targetParams = target.parameters.filter(
        p => p.in === 'path' || (p.in === 'query' && p.required)
      )
      if (targetParams.length === 0) continue

      const bindings: DataBinding[] = []

      for (const field of source.responseFields) {
        for (const param of targetParams) {
          let confidence = 0

          // Exact match
          if (field.name === param.name) {
            confidence = 0.9
          }
          // Case-insensitive match
          else if (field.name.toLowerCase() === param.name.toLowerCase()) {
            confidence = 0.8
          }
          // Normalized match (strip separators)
          else if (normalize(field.name) === normalize(param.name)) {
            confidence = 0.7
          }
          // ID-like field matching: "id" field → any path param named *id*
          else if (field.name.toLowerCase() === 'id' && isIdLike(param.name) && param.in === 'path') {
            confidence = 0.75
          }

          if (confidence > 0) {
            bindings.push({
              sourceField: field.path,
              targetParam: param.name,
              targetParamIn: param.in,
              confidence,
            })
          }
        }
      }

      if (bindings.length > 0) {
        // Use the best binding confidence as the edge score
        const bestConfidence = Math.max(...bindings.map(b => b.confidence))
        const signal: EdgeSignal = {
          signal: SIGNAL_NAME,
          weight: SIGNAL_WEIGHT,
          matched: true,
          detail: bindings.map(b => `${b.sourceField} → ${b.targetParam}`).join(', '),
        }

        edges.push({
          sourceId: source.id,
          targetId: target.id,
          bindings,
          score: bestConfidence * SIGNAL_WEIGHT,
          signals: [signal],
        })
      }
    }
  }

  return edges
}
