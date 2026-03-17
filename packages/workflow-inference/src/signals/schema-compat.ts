/**
 * Schema Compatibility Signal — matches output types/formats to input types/formats.
 *
 * Scoring:
 * - Matching type + format (e.g. both string/uuid): 0.6
 * - Matching type only (both string): 0.2 (too weak alone, supplementary)
 */

import type { InferenceOperation, OperationEdge, DataBinding, EdgeSignal } from '../types'

const SIGNAL_NAME = 'schema-compat'
const SIGNAL_WEIGHT = 0.25

/**
 * Schema Compatibility signal: match response field types/formats to input param types/formats.
 */
export function detectSchemaCompat(operations: InferenceOperation[]): OperationEdge[] {
  const edges: OperationEdge[] = []

  for (const source of operations) {
    if (source.responseFields.length === 0) continue

    for (const target of operations) {
      if (source.id === target.id) continue

      const targetParams = target.parameters.filter(p => p.in === 'path' || p.in === 'query')
      if (targetParams.length === 0) continue

      const bindings: DataBinding[] = []

      for (const field of source.responseFields) {
        for (const param of targetParams) {
          let confidence = 0

          // Type + format match (strong)
          if (field.format && param.format && field.format === param.format && field.type === param.type) {
            confidence = 0.6
          }
          // Type-only match (weak, supplementary)
          else if (field.type === param.type && field.type !== 'string') {
            // Only count non-string type matches — string/string is too common
            confidence = 0.2
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
        const bestConfidence = Math.max(...bindings.map(b => b.confidence))

        // Only emit edge if we have a reasonably strong match
        if (bestConfidence >= 0.3) {
          const signal: EdgeSignal = {
            signal: SIGNAL_NAME,
            weight: SIGNAL_WEIGHT,
            matched: true,
            detail: `${bindings.length} type/format matches (best: ${bestConfidence})`,
          }

          edges.push({
            sourceId: source.id,
            targetId: target.id,
            bindings: bindings.filter(b => b.confidence >= 0.3),
            score: bestConfidence * SIGNAL_WEIGHT,
            signals: [signal],
          })
        }
      }
    }
  }

  return edges
}
