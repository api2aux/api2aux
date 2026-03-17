/**
 * Graph builder — runs all signals, merges edges, applies plugin boosts.
 */

import type { InferenceOperation, OperationEdge, OperationGraph } from './types'
import type { WorkflowPatternHint } from '@api2aux/semantic-analysis'
import { detectIdPatterns } from './signals/id-pattern'
import { detectRestConventions } from './signals/rest-conventions'
import { detectSchemaCompat } from './signals/schema-compat'
import { detectTagProximity } from './signals/tag-proximity'
import { detectNameSimilarity } from './signals/name-similarity'

/** Minimum edge score to keep in the graph. */
const EDGE_THRESHOLD = 0.15

/** Edge key for merging. */
function edgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}→${targetId}`
}

/**
 * Merge edges with the same (source, target) pair.
 * Combines signals, sums scores, unions bindings.
 */
function mergeEdges(allEdges: OperationEdge[]): OperationEdge[] {
  const merged = new Map<string, OperationEdge>()

  for (const edge of allEdges) {
    const key = edgeKey(edge.sourceId, edge.targetId)
    const existing = merged.get(key)

    if (!existing) {
      merged.set(key, { ...edge, signals: [...edge.signals], bindings: [...edge.bindings] })
    } else {
      existing.score += edge.score
      existing.signals.push(...edge.signals)

      // Merge bindings (deduplicate by sourceField+targetParam)
      for (const binding of edge.bindings) {
        const exists = existing.bindings.some(
          b => b.sourceField === binding.sourceField && b.targetParam === binding.targetParam
        )
        if (!exists) {
          existing.bindings.push(binding)
        }
      }
    }
  }

  return Array.from(merged.values())
}

/**
 * Apply plugin workflow pattern boosts to matching edges.
 */
function applyPluginBoosts(
  edges: OperationEdge[],
  operations: InferenceOperation[],
  patterns: WorkflowPatternHint[],
): void {
  if (patterns.length === 0) return

  const opById = new Map(operations.map(o => [o.id, o]))

  for (const pattern of patterns) {
    // For each pair of adjacent steps in the pattern, boost matching edges
    for (let i = 0; i < pattern.steps.length - 1; i++) {
      const stepA = pattern.steps[i]!
      const stepB = pattern.steps[i + 1]!

      for (const edge of edges) {
        const sourceOp = opById.get(edge.sourceId)
        const targetOp = opById.get(edge.targetId)
        if (!sourceOp || !targetOp) continue

        const sourceMatches = matchesPattern(sourceOp.id, stepA.operationPattern)
        const targetMatches = matchesPattern(targetOp.id, stepB.operationPattern)

        if (sourceMatches && targetMatches) {
          edge.score += pattern.edgeWeightBoost
          edge.signals.push({
            signal: 'plugin-boost',
            weight: pattern.edgeWeightBoost,
            matched: true,
            detail: `Plugin pattern: ${pattern.name} (${stepA.role} → ${stepB.role})`,
          })
        }
      }
    }
  }
}

/** Check if an operation ID matches a pattern (string prefix or RegExp). */
function matchesPattern(opId: string, pattern: string | RegExp): boolean {
  try {
    if (pattern instanceof RegExp) {
      return pattern.test(opId)
    }
    return opId.toLowerCase().includes(pattern.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Normalize edge scores to 0.0-1.0 range.
 */
function normalizeScores(edges: OperationEdge[]): void {
  if (edges.length === 0) return
  const maxScore = Math.max(...edges.map(e => e.score))
  if (maxScore <= 0) return

  for (const edge of edges) {
    edge.score = edge.score / maxScore
  }
}

/**
 * Build a weighted directed graph from operations.
 * Runs all signals, merges edges, applies plugin boosts, filters by threshold.
 */
export function buildOperationGraph(
  operations: InferenceOperation[],
  pluginPatterns?: WorkflowPatternHint[],
): OperationGraph {
  // Run all signals independently
  const allEdges: OperationEdge[] = [
    ...detectIdPatterns(operations),
    ...detectRestConventions(operations),
    ...detectSchemaCompat(operations),
    ...detectTagProximity(operations),
    ...detectNameSimilarity(operations),
  ]

  // Merge edges with same (source, target)
  const merged = mergeEdges(allEdges)

  // Apply plugin boosts
  if (pluginPatterns && pluginPatterns.length > 0) {
    applyPluginBoosts(merged, operations, pluginPatterns)
  }

  // Normalize scores to 0.0-1.0
  normalizeScores(merged)

  // Filter by threshold
  const filtered = merged.filter(e => e.score >= EDGE_THRESHOLD)

  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score)

  return {
    nodes: operations,
    edges: filtered,
  }
}
