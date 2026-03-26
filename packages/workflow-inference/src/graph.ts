/**
 * Graph builder — runs all signals, merges edges, applies plugin boosts.
 */

import { BuiltInSignal } from './types'
import type { InferenceOperation, OperationEdge, OperationGraph, SignalError, SignalFunction, SignalRegistration } from './types'
import type { WorkflowPatternHint } from '@api2aux/semantic-analysis'
import { signalRegistry } from './signals/registry'

/** Minimum edge score to keep in the graph. */
const EDGE_THRESHOLD = 0.15

/** Maximum accumulated score before normalization (prevents one pair from dominating). */
const MAX_RAW_SCORE = 1.5

/** Run a signal function safely, returning empty array on failure and tracking the error. */
function safeRunSignal(
  fn: SignalFunction,
  operations: InferenceOperation[],
  label: string,
  errors: SignalError[],
): OperationEdge[] {
  try {
    return fn(operations)
  } catch (err) {
    console.error(`[workflow-inference] ${label} signal failed:`, err)
    errors.push({ id: label, error: err })
    return []
  }
}

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
      existing.score = Math.min(existing.score + edge.score, MAX_RAW_SCORE)
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
/** Maximum total plugin boost per edge. */
const MAX_PLUGIN_BOOST = 0.5

function applyPluginBoosts(
  edges: OperationEdge[],
  operations: InferenceOperation[],
  patterns: WorkflowPatternHint[],
): void {
  if (patterns.length === 0) return

  const opById = new Map(operations.map(o => [o.id, o]))
  const boostAccum = new Map<string, number>()

  for (const pattern of patterns) {
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
          const key = `${edge.sourceId}→${edge.targetId}`
          const accumulated = boostAccum.get(key) ?? 0
          if (accumulated >= MAX_PLUGIN_BOOST) continue
          const boost = Math.min(pattern.edgeWeightBoost, MAX_PLUGIN_BOOST - accumulated)
          edge.score += boost
          boostAccum.set(key, accumulated + boost)
          edge.signals.push({
            signal: BuiltInSignal.PluginBoost,
            weight: boost,
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
  } catch (err) {
    console.error(`[workflow-inference] matchesPattern failed for pattern ${String(pattern)} on opId "${opId}":`, err)
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
  runtimeEdges?: OperationEdge[],
  signals?: SignalRegistration[],
): OperationGraph {
  // Run all signals independently with per-signal isolation.
  // Use provided signals if given, otherwise use the global registry.
  const activeSignals = signals ?? signalRegistry.getAll()
  const allEdges: OperationEdge[] = []
  const signalErrors: SignalError[] = []
  for (const { id, signal } of activeSignals) {
    allEdges.push(...safeRunSignal(signal, operations, id, signalErrors))
  }

  // Merge runtime-discovered edges if available
  if (runtimeEdges && runtimeEdges.length > 0) {
    allEdges.push(...runtimeEdges)
  }

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
    signalErrors,
  }
}
