/**
 * Hook that computes and caches workflow analysis for a parsed API spec.
 * Runs the deterministic inference engine once per spec and memoizes results.
 */

import { useMemo } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { enrichmentRegistry } from '@api2aux/semantic-analysis'
import { analyzeWorkflows } from '@api2aux/workflow-inference'
import type { OperationGraph, Workflow } from '@api2aux/workflow-inference'

export interface WorkflowAnalysisResult {
  graph: OperationGraph
  workflows: Workflow[]
  /** Map of operationId → workflow patterns it participates in */
  operationWorkflows: Map<string, Workflow[]>
  /** Map of operationId → related operation IDs (connected via edges) */
  relatedOperations: Map<string, RelatedOperation[]>
}

export interface RelatedOperation {
  operationId: string
  /** 'next' = this op consumes the selected op's output, 'prev' = this op produces the selected op's input */
  direction: 'next' | 'prev'
  /** Description of the relationship */
  binding: string
  /** Edge score */
  score: number
  /** HTTP method of the related operation (for display) */
  method: string
  /** URL path of the related operation (for display) */
  path: string
  /** Operation summary (for display when paths are ambiguous) */
  summary?: string
}

/**
 * Compute workflow analysis for a parsed API spec.
 * Memoized — only recomputes when the spec changes.
 */
export function useWorkflowAnalysis(parsedSpec: ParsedAPI | null): WorkflowAnalysisResult | null {
  return useMemo(() => {
    if (!parsedSpec || parsedSpec.operations.length === 0) return null

    try {
      const pluginPatterns = enrichmentRegistry.getWorkflowPatterns()
      const { graph, workflows } = analyzeWorkflows(parsedSpec.operations, {
        pluginPatterns: pluginPatterns.length > 0 ? pluginPatterns : undefined,
      })

      // Build operation → workflows lookup
      const operationWorkflows = new Map<string, Workflow[]>()
      for (const wf of workflows) {
        for (const step of wf.steps) {
          const list = operationWorkflows.get(step.operationId) || []
          list.push(wf)
          operationWorkflows.set(step.operationId, list)
        }
      }

      // Build operation lookup for method/path display
      const opById = new Map(parsedSpec.operations.map(o => [o.id, o]))

      // Build score index for symmetric edge filtering.
      // When A→B and B→A both exist:
      //  - Dominant direction (score ≥ 1.5× reverse) → keep
      //  - Equal scores ≥ 0.55 → keep one direction (same-group relationships)
      //  - Equal scores < 0.55 → drop both (cross-group noise like {index} siblings)
      //  - Otherwise → drop (weak reverse)
      const edgeScoreByKey = new Map<string, number>()
      for (const edge of graph.edges) {
        if (edge.bindings.length === 0) continue
        edgeScoreByKey.set(`${edge.sourceId}→${edge.targetId}`, edge.score)
      }

      // Build operation → related operations lookup (deduplicated by operationId+direction)
      const relatedRaw = new Map<string, Map<string, RelatedOperation>>()

      for (const edge of graph.edges) {
        if (edge.bindings.length === 0) continue
        const reverseScore = edgeScoreByKey.get(`${edge.targetId}→${edge.sourceId}`)
        if (reverseScore !== undefined && edge.score < reverseScore * 1.5) {
          // Equal-score pairs above threshold: keep one direction (lexicographically first)
          // Below threshold (e.g. cross-group {index} siblings at ~0.5): drop both
          if (Math.abs(edge.score - reverseScore) < 0.001 && edge.score >= 0.55 && edge.sourceId < edge.targetId) {
            // keep — chosen forward direction
          } else {
            continue
          }
        }
        const bindingDesc = edge.bindings.map(b => `passes ${b.sourceField}`).join(', ')

        const targetOp = opById.get(edge.targetId)
        const sourceOp = opById.get(edge.sourceId)

        // Forward: source → target (source's "next")
        if (targetOp) {
          const key = `next:${edge.targetId}`
          const sourceMap = relatedRaw.get(edge.sourceId) || new Map()
          const existing = sourceMap.get(key)
          if (!existing || edge.score > existing.score) {
            sourceMap.set(key, {
              operationId: edge.targetId,
              direction: 'next',
              binding: bindingDesc,
              score: edge.score,
              method: targetOp.method,
              path: targetOp.path,
              summary: targetOp.summary,
            })
          }
          relatedRaw.set(edge.sourceId, sourceMap)
        }

        // Backward: target → source (target's "prev")
        if (sourceOp) {
          const key = `prev:${edge.sourceId}`
          const targetMap = relatedRaw.get(edge.targetId) || new Map()
          const existing = targetMap.get(key)
          if (!existing || edge.score > existing.score) {
            targetMap.set(key, {
              operationId: edge.sourceId,
              direction: 'prev',
              binding: bindingDesc,
              score: edge.score,
              method: sourceOp.method,
              path: sourceOp.path,
              summary: sourceOp.summary,
            })
          }
          relatedRaw.set(edge.targetId, targetMap)
        }
      }

      // Flatten deduplicated maps
      const relatedOperations = new Map<string, RelatedOperation[]>()
      for (const [opId, deduped] of relatedRaw) {
        relatedOperations.set(opId, Array.from(deduped.values()))
      }

      return { graph, workflows, operationWorkflows, relatedOperations }
    } catch (err) {
      console.error('[useWorkflowAnalysis] Workflow analysis failed:', err)
      return null
    }
  }, [parsedSpec])
}
