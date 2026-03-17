/**
 * Hook that computes and caches workflow analysis for a parsed API spec.
 * Runs the deterministic inference engine once per spec and memoizes results.
 */

import { useMemo } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { enrichmentRegistry } from '@api2aux/semantic-analysis'
import { analyzeWorkflows } from '@api2aux/workflow-inference'
import type { OperationGraph, Workflow, OperationEdge } from '@api2aux/workflow-inference'

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
}

/**
 * Compute workflow analysis for a parsed API spec.
 * Memoized — only recomputes when the spec changes.
 */
export function useWorkflowAnalysis(parsedSpec: ParsedAPI | null): WorkflowAnalysisResult | null {
  return useMemo(() => {
    if (!parsedSpec || parsedSpec.operations.length === 0) return null

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

    // Build operation → related operations lookup
    const relatedOperations = new Map<string, RelatedOperation[]>()
    for (const edge of graph.edges) {
      // Forward: source → target (source's "next steps")
      const nextList = relatedOperations.get(edge.sourceId) || []
      const bindingDesc = edge.bindings.length > 0
        ? edge.bindings.map(b => `${b.targetParam} ← ${b.sourceField}`).join(', ')
        : 'related'
      nextList.push({
        operationId: edge.targetId,
        direction: 'next',
        binding: bindingDesc,
        score: edge.score,
      })
      relatedOperations.set(edge.sourceId, nextList)

      // Backward: target → source (target's "depends on")
      const prevList = relatedOperations.get(edge.targetId) || []
      prevList.push({
        operationId: edge.sourceId,
        direction: 'prev',
        binding: bindingDesc,
        score: edge.score,
      })
      relatedOperations.set(edge.targetId, prevList)
    }

    return { graph, workflows, operationWorkflows, relatedOperations }
  }, [parsedSpec])
}
