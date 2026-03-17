/**
 * @api2aux/workflow-inference
 *
 * Deterministic API endpoint relationship inference engine.
 * Discovers how API endpoints chain together using multi-signal analysis:
 * ID pattern matching, REST conventions, schema compatibility, tag proximity, and name similarity.
 *
 * Zero LLM dependency — all inference is deterministic and fast.
 * Optional LLM disambiguator hook for refining ambiguous matches.
 */

// === Types ===
export type {
  InferenceOperation,
  InferenceParam,
  InferenceField,
  OperationEdge,
  DataBinding,
  EdgeSignal,
  OperationGraph,
  Workflow,
  WorkflowStep,
  SignalFunction,
} from './types'
export { WorkflowPattern } from './types'

// === Converter ===
export { operationsToInference } from './convert'

// === Signals ===
export { detectIdPatterns } from './signals/id-pattern'
export { detectRestConventions } from './signals/rest-conventions'
export { detectSchemaCompat } from './signals/schema-compat'
export { detectTagProximity } from './signals/tag-proximity'
export { detectNameSimilarity } from './signals/name-similarity'

// === Graph ===
export { buildOperationGraph } from './graph'

// === Composer ===
export { inferWorkflows, findWorkflowTo } from './composer'

// === Disambiguator ===
export { noopDisambiguator, extractAmbiguousEdges, applyDisambiguation } from './disambiguator'
export type { WorkflowDisambiguator } from './disambiguator'

// === Export ===
export { toArazzo } from './export/arazzo'
export type { ArazzoDocument } from './export/arazzo'

// === One-shot convenience ===

import type { WorkflowPatternHint } from '@api2aux/semantic-analysis'
import type { OperationGraph, Workflow } from './types'
import { operationsToInference } from './convert'
import { buildOperationGraph } from './graph'
import { inferWorkflows } from './composer'

/**
 * One-shot: convert operations, build graph, infer workflows.
 * Accepts api-invoke Operation[] (or any structurally compatible array).
 */
export function analyzeWorkflows(
  operations: Parameters<typeof operationsToInference>[0],
  options?: { pluginPatterns?: WorkflowPatternHint[] },
): { graph: OperationGraph; workflows: Workflow[] } {
  const inferenceOps = operationsToInference(operations)
  const graph = buildOperationGraph(inferenceOps, options?.pluginPatterns)
  const workflows = inferWorkflows(graph)
  return { graph, workflows }
}
