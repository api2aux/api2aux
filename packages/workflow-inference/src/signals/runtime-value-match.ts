/**
 * Runtime Value Match Signal — discovers endpoint relationships from live data.
 *
 * Cross-probes: matches values extracted from one endpoint's response against
 * parameters of other endpoints. This catches semantic cross-resource references
 * that static analysis can't detect.
 *
 * Example: GET /api/skills/acrobatics returns { ability_score: { index: "dex" } }
 * and "dex" is a valid {index} for GET /api/ability-scores/{index}.
 * Static signals miss this because both use {index} but with different value domains.
 *
 * Confidence levels:
 * - Value matches param's declared enum: 0.95
 * - Value matches param's example value: 0.85
 * - Value appears in another probe's response where field name ≈ param name: 0.80
 */

import type {
  InferenceOperation,
  OperationEdge,
  DataBinding,
  EdgeSignal,
  RuntimeProbeResult,
} from '../types'

const SIGNAL_NAME = 'runtime-value-match'
const SIGNAL_WEIGHT = 0.40

/** Normalize a name for fuzzy comparison: lowercase, strip separators. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

/** Extract the leaf field name from a dotted path (e.g. 'ability_score.index' → 'index'). */
function leafName(fieldPath: string): string {
  const parts = fieldPath.split('.')
  return parts[parts.length - 1] ?? fieldPath
}

/** Check if a field name approximately matches a parameter name. */
function namesMatch(fieldName: string, paramName: string): boolean {
  if (fieldName === paramName) return true
  if (fieldName.toLowerCase() === paramName.toLowerCase()) return true
  if (normalize(fieldName) === normalize(paramName)) return true
  return false
}

/**
 * Build a lookup from operationId → values grouped by leaf field name.
 * Used for cross-probe matching (checking if a value from probe A
 * appears in probe B's response under a matching field name).
 */
function buildValueIndex(
  probeResults: RuntimeProbeResult[],
): Map<string, Map<string, Set<string | number>>> {
  // operationId → normalized(fieldLeaf) → set of values
  const index = new Map<string, Map<string, Set<string | number>>>()

  for (const probe of probeResults) {
    if (!probe.success) continue
    const fieldMap = new Map<string, Set<string | number>>()
    for (const v of probe.values) {
      const leaf = normalize(leafName(v.fieldPath))
      let set = fieldMap.get(leaf)
      if (!set) {
        set = new Set()
        fieldMap.set(leaf, set)
      }
      set.add(v.value)
    }
    index.set(probe.operationId, fieldMap)
  }

  return index
}

/**
 * Match runtime probe values against operation parameters to discover edges.
 *
 * For each probed value V at path P from operation A:
 *   For each other operation B with a parameter Q:
 *     Check if V appears in:
 *       a. Q's declared enum → confidence 0.95
 *       b. Q's example value → confidence 0.85
 *       c. Values from probing B (or B's list sibling) where field name ≈ Q.name → confidence 0.80
 *     If match: create edge A→B with binding P → Q
 */
export function matchRuntimeValues(
  probeResults: RuntimeProbeResult[],
  operations: InferenceOperation[],
): OperationEdge[] {
  const edges: OperationEdge[] = []
  const valueIndex = buildValueIndex(probeResults)

  // Successful probes only
  const successfulProbes = probeResults.filter(p => p.success)
  if (successfulProbes.length === 0) return edges

  // Operation lookup
  const opById = new Map(operations.map(o => [o.id, o]))

  for (const probe of successfulProbes) {
    if (probe.values.length === 0) continue

    for (const target of operations) {
      // Don't create self-edges
      if (target.id === probe.operationId) continue

      // Only match against path and required query params
      const targetParams = target.parameters.filter(
        p => p.in === 'path' || (p.in === 'query' && p.required)
      )
      if (targetParams.length === 0) continue

      const bindings: DataBinding[] = []

      for (const probeValue of probe.values) {
        for (const param of targetParams) {
          let confidence = 0
          const value = probeValue.value

          // a. Value matches param's declared enum
          if (param.enum && param.enum.length > 0) {
            if (param.enum.some(e => e === value || String(e) === String(value))) {
              confidence = Math.max(confidence, 0.95)
            }
          }

          // b. Value matches param's example
          if (param.example !== undefined) {
            if (param.example === value || String(param.example) === String(value)) {
              confidence = Math.max(confidence, 0.85)
            }
          }

          // c. Cross-probe: value appears in another probe's response
          //    under a field whose name matches the target param name
          if (confidence === 0) {
            // Check target operation's own probe results
            const targetValues = valueIndex.get(target.id)
            if (targetValues) {
              const normalizedParam = normalize(param.name)
              const matchingValues = targetValues.get(normalizedParam)
              if (matchingValues && matchingValues.has(value)) {
                confidence = Math.max(confidence, 0.80)
              }
            }

            // Also check list siblings of the target (e.g. if target is /items/{id},
            // check /items list endpoint probe for matching values)
            if (confidence === 0) {
              const targetBasePath = target.path.replace(/\/\{[^}]+\}$/, '')
              for (const [opId, fieldMap] of valueIndex) {
                if (opId === probe.operationId || opId === target.id) continue
                const siblingOp = opById.get(opId)
                if (!siblingOp) continue
                // List sibling: same base path, GET, fewer params
                const siblingBasePath = siblingOp.path.replace(/\/\{[^}]+\}$/, '')
                if (siblingBasePath !== targetBasePath || siblingOp.method !== 'GET') continue

                const normalizedParam = normalize(param.name)
                const matchingValues = fieldMap.get(normalizedParam)
                if (matchingValues && matchingValues.has(value)) {
                  confidence = Math.max(confidence, 0.80)
                  break
                }
              }
            }
          }

          // Also require the field name to be plausibly related to the param name
          // to avoid noise (e.g. a random "3" matching an integer param)
          if (confidence > 0 && probeValue.type === 'number' && confidence < 0.90) {
            // For numbers, require field name similarity to reduce false positives
            const leaf = leafName(probeValue.fieldPath)
            if (!namesMatch(leaf, param.name)) {
              confidence = 0
            }
          }

          if (confidence > 0) {
            // Deduplicate: skip if we already have a binding for this param with higher confidence
            const existing = bindings.find(b => b.targetParam === param.name)
            if (existing && existing.confidence >= confidence) continue
            if (existing) {
              existing.sourceField = probeValue.fieldPath
              existing.confidence = confidence
            } else {
              bindings.push({
                sourceField: probeValue.fieldPath,
                targetParam: param.name,
                targetParamIn: param.in,
                confidence,
              })
            }
          }
        }
      }

      if (bindings.length > 0) {
        const bestConfidence = Math.max(...bindings.map(b => b.confidence))
        const signal: EdgeSignal = {
          signal: SIGNAL_NAME,
          weight: SIGNAL_WEIGHT,
          matched: true,
          detail: bindings.map(b => `${b.sourceField} → ${b.targetParam} (${b.confidence})`).join(', '),
        }

        edges.push({
          sourceId: probe.operationId,
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
