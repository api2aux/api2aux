/**
 * LLM Disambiguator — optional hook for refining ambiguous matches.
 *
 * The default implementation is a noop that returns matches unchanged.
 * Enrichment plugins can provide real implementations via EnrichmentPlugin.disambiguate.
 */

import type { AmbiguousMatch, DisambiguationResult } from '@api2aux/semantic-analysis'
import { BuiltInSignal } from './types'
import type { OperationEdge, OperationGraph } from './types'

export type { AmbiguousMatch, DisambiguationResult }

/** Threshold range for ambiguous edges that benefit from disambiguation. */
const AMBIGUOUS_LOW = 0.25
const AMBIGUOUS_HIGH = 0.55

/** Interface for a workflow disambiguator. */
export interface WorkflowDisambiguator {
  disambiguate(matches: AmbiguousMatch[]): Promise<DisambiguationResult[]>
}

/** Default noop disambiguator — returns all matches as unconfirmed. */
export const noopDisambiguator: WorkflowDisambiguator = {
  async disambiguate(matches: AmbiguousMatch[]): Promise<DisambiguationResult[]> {
    return matches.map(m => ({
      sourceOperationId: m.sourceOperationId,
      targetOperationId: m.targetOperationId,
      refinedScore: m.currentScore,
      confirmed: false,
    }))
  },
}

/**
 * Extract ambiguous edges from a graph for disambiguation.
 * Returns edges scoring between AMBIGUOUS_LOW and AMBIGUOUS_HIGH.
 */
export function extractAmbiguousEdges(graph: OperationGraph): AmbiguousMatch[] {
  return graph.edges
    .filter(e => e.score >= AMBIGUOUS_LOW && e.score <= AMBIGUOUS_HIGH)
    .map(edgeToAmbiguousMatch)
}

/** Convert an edge to an AmbiguousMatch. */
function edgeToAmbiguousMatch(edge: OperationEdge): AmbiguousMatch {
  const bestBinding = edge.bindings.length > 0
    ? edge.bindings.reduce((a, b) => a.confidence > b.confidence ? a : b)
    : null

  return {
    sourceOperationId: edge.sourceId,
    targetOperationId: edge.targetId,
    sourceField: bestBinding?.sourceField ?? '(unknown)',
    targetParam: bestBinding?.targetParam ?? '(unknown)',
    currentScore: edge.score,
    context: edge.signals.map(s => s.detail).filter(Boolean).join('; '),
  }
}

/**
 * Apply disambiguation results back to the graph.
 * Updates edge scores for confirmed/rejected matches.
 */
export function applyDisambiguation(
  graph: OperationGraph,
  results: DisambiguationResult[],
): void {
  const resultMap = new Map(
    results.map(r => [`${r.sourceOperationId}→${r.targetOperationId}`, r])
  )

  for (const edge of graph.edges) {
    const key = `${edge.sourceId}→${edge.targetId}`
    const result = resultMap.get(key)
    if (result) {
      edge.score = Math.max(0, Math.min(1, result.refinedScore))
      edge.signals.push({
        signal: BuiltInSignal.LlmDisambiguation,
        weight: 0,
        matched: result.confirmed,
        detail: result.reasoning || (result.confirmed ? 'LLM confirmed' : 'LLM rejected'),
      })
    }
  }
}
