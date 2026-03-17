/**
 * ID Pattern Signal — the strongest signal (~60-70% of real chains).
 *
 * Detects when a response field from operation A matches a path/query parameter
 * in operation B. For example, if A returns { userId: "123" } and B has a
 * path parameter {userId}, they can chain.
 *
 * IMPORTANT: Generic field names (id, index, key, slug, etc.) are only matched
 * when the operations are semantically related (shared tags or path prefix).
 * This prevents noise like /monsters → /skills/{index} just because both use "index".
 *
 * Specific field names (userId, productId, monster_id) can match broadly because
 * the name itself carries semantic meaning.
 *
 * Scoring:
 * - Exact specific name match: 0.9
 * - Exact generic name match (with context): 0.75
 * - Case-insensitive match: 0.8
 * - Normalized match (strip separators): 0.7
 */

import type { InferenceOperation, OperationEdge, DataBinding, EdgeSignal } from '../types'

const SIGNAL_NAME = 'id-pattern'
const SIGNAL_WEIGHT = 0.35

/** Normalize a field/param name for comparison: lowercase, strip separators. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

/**
 * Check if a field/param name is "generic" — a bare identifier word without
 * a resource qualifier. Generic names need context (tags/path) to match.
 *
 * Generic: "id", "index", "key", "slug", "name", "type", "code"
 * Specific: "userId", "product_id", "monster_index", "order_code"
 *
 * The heuristic: a name is specific if it's a compound word (has a prefix
 * before the identifier suffix). Single-word names are generic.
 */
function isGenericName(name: string): boolean {
  // Split on camelCase boundaries, underscores, and hyphens
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[-_]+/)
    .filter(Boolean)

  // Single-word names are generic (id, index, key, slug, name, type, code, etc.)
  return parts.length <= 1
}


/**
 * Check if two operations are semantically related via tags or path proximity.
 * This is the gate for generic name matching.
 */
function areRelated(source: InferenceOperation, target: InferenceOperation): boolean {
  // Shared tags
  if (source.tags.length > 0 && target.tags.length > 0) {
    for (const tag of source.tags) {
      if (target.tags.includes(tag)) return true
    }
  }

  // Shared path prefix (first 2 non-param segments)
  const sourcePrefix = getPathPrefix(source.path)
  const targetPrefix = getPathPrefix(target.path)
  if (sourcePrefix && targetPrefix && sourcePrefix === targetPrefix) return true

  // Direct parent-child path: /resources → /resources/{id}
  const sourcePath = source.path.replace(/\/\{[^}]+\}$/, '')
  const targetPath = target.path.replace(/\/\{[^}]+\}$/, '')
  if (sourcePath === targetPath) return true

  return false
}

/** Get path prefix for proximity check (first 2 non-param segments). */
function getPathPrefix(path: string): string {
  return path
    .split('/')
    .filter(s => s && !s.startsWith('{'))
    .slice(0, 2)
    .join('/')
}

/**
 * ID Pattern signal: match response fields to path/query params across operations.
 *
 * Generic names (id, index) only match between related operations (shared tags/path).
 * Specific names (userId, productId) match broadly.
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

      // Pre-check: are these operations related? (needed for generic name matching)
      const related = areRelated(source, target)

      const bindings: DataBinding[] = []

      for (const field of source.responseFields) {
        for (const param of targetParams) {
          // Determine if this is a generic or specific match
          const fieldIsGeneric = isGenericName(field.name)
          const paramIsGeneric = isGenericName(param.name)
          const bothGeneric = fieldIsGeneric && paramIsGeneric

          // Generic names require context (tags or path proximity)
          if (bothGeneric && !related) continue

          let confidence = 0

          // Exact match
          if (field.name === param.name) {
            confidence = bothGeneric ? 0.75 : 0.9
          }
          // Case-insensitive match
          else if (field.name.toLowerCase() === param.name.toLowerCase()) {
            confidence = bothGeneric ? 0.65 : 0.8
          }
          // Normalized match (strip separators)
          else if (normalize(field.name) === normalize(param.name)) {
            confidence = bothGeneric ? 0.55 : 0.7
          }
          // Specific response "id" → specific param like "userId"
          // Only when field is generic "id" and param is specific "*Id"
          else if (fieldIsGeneric && !isGenericName(param.name) && param.in === 'path' && related) {
            confidence = 0.6
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
