/**
 * Workflow composer — extracts named workflows from the operation graph.
 * Detects common patterns: Browse, CRUD, Search→Detail, Create→Get.
 */

import type {
  OperationGraph,
  InferenceOperation,
  OperationEdge,
  Workflow,
  WorkflowStep,
} from './types'
import { WorkflowPattern } from './types'

let workflowCounter = 0
function nextId(): string {
  return `wf-${++workflowCounter}`
}

/** Reset counter (for testing). */
export function resetWorkflowCounter(): void {
  workflowCounter = 0
}

/** Get base path by stripping the trailing {param} segment. */
function getBasePath(path: string): string {
  return path.replace(/\/\{[^}]+\}$/, '') || '/'
}

/** Count path parameter segments in a path. */
function countPathParams(path: string): number {
  return (path.match(/\{[^}]+\}/g) || []).length
}

/** Check if a path has any path parameters. */
function hasPathParams(path: string): boolean {
  return path.includes('{')
}

/** Find edges from source to target. */
function findEdge(edges: OperationEdge[], sourceId: string, targetId: string): OperationEdge | undefined {
  return edges.find(e => e.sourceId === sourceId && e.targetId === targetId)
}

/** Create a workflow step with bindings from the edge. */
function makeStep(opId: string, role: string, edge?: OperationEdge): WorkflowStep {
  return {
    operationId: opId,
    role,
    inputBindings: edge?.bindings ?? [],
  }
}

/**
 * Detect Browse workflows: GET /resources → GET /resources/{id}
 */
function detectBrowseWorkflows(graph: OperationGraph): Workflow[] {
  const workflows: Workflow[] = []
  const { nodes, edges } = graph

  // Group by base path
  const groups = new Map<string, InferenceOperation[]>()
  for (const op of nodes) {
    const base = getBasePath(op.path)
    const list = groups.get(base) || []
    list.push(op)
    groups.set(base, list)
  }

  for (const [basePath, ops] of groups) {
    const baseParamCount = countPathParams(basePath)
    const listOp = ops.find(o => o.method === 'GET' && countPathParams(o.path) === baseParamCount)
    const detailOp = ops.find(o => o.method === 'GET' && countPathParams(o.path) > baseParamCount)

    if (listOp && detailOp) {
      const edge = findEdge(edges, listOp.id, detailOp.id)
      const resourceName = basePath.split('/').filter(s => Boolean(s) && !s.startsWith('{')).pop() || 'resource'

      workflows.push({
        id: nextId(),
        name: `Browse ${resourceName}`,
        description: `List ${resourceName} then view details by ID.`,
        pattern: WorkflowPattern.Browse,
        steps: [
          makeStep(listOp.id, 'list'),
          makeStep(detailOp.id, 'detail', edge),
        ],
        confidence: edge ? Math.min(edge.score + 0.3, 1.0) : 0.7,
      })
    }
  }

  return workflows
}

/**
 * Detect CRUD workflows: same base path with POST + GET-detail + PUT/PATCH + DELETE.
 */
function detectCRUDWorkflows(graph: OperationGraph): Workflow[] {
  const workflows: Workflow[] = []
  const { nodes, edges } = graph

  const groups = new Map<string, InferenceOperation[]>()
  for (const op of nodes) {
    const base = getBasePath(op.path)
    const list = groups.get(base) || []
    list.push(op)
    groups.set(base, list)
  }

  for (const [basePath, ops] of groups) {
    const baseParamCount = countPathParams(basePath)
    const createOp = ops.find(o => o.method === 'POST' && countPathParams(o.path) === baseParamCount)
    const detailOp = ops.find(o => o.method === 'GET' && countPathParams(o.path) > baseParamCount)
    const updateOp = ops.find(o => (o.method === 'PUT' || o.method === 'PATCH') && countPathParams(o.path) > baseParamCount)
    const deleteOp = ops.find(o => o.method === 'DELETE' && countPathParams(o.path) > baseParamCount)

    const crudOps = [createOp, detailOp, updateOp, deleteOp].filter(Boolean)
    if (crudOps.length < 3) continue // Need at least 3 CRUD operations

    const resourceName = basePath.split('/').filter(s => Boolean(s) && !s.startsWith('{')).pop() || 'resource'
    const steps: WorkflowStep[] = []

    if (createOp) steps.push(makeStep(createOp.id, 'create'))
    if (detailOp) {
      const edge = createOp ? findEdge(edges, createOp.id, detailOp.id) : undefined
      steps.push(makeStep(detailOp.id, 'read', edge))
    }
    if (updateOp) {
      const edge = detailOp ? findEdge(edges, detailOp.id, updateOp.id) : undefined
      steps.push(makeStep(updateOp.id, 'update', edge))
    }
    if (deleteOp) {
      const edge = detailOp ? findEdge(edges, detailOp.id, deleteOp.id) : undefined
      steps.push(makeStep(deleteOp.id, 'delete', edge))
    }

    workflows.push({
      id: nextId(),
      name: `${resourceName} CRUD`,
      description: `Create, read, update, and delete ${resourceName}.`,
      pattern: WorkflowPattern.CRUD,
      steps,
      confidence: 0.9,
    })
  }

  return workflows
}

/**
 * Detect Search→Detail workflows: operation with search params → detail endpoint.
 */
function detectSearchDetailWorkflows(graph: OperationGraph): Workflow[] {
  const workflows: Workflow[] = []
  const { nodes, edges } = graph

  const SEARCH_PARAMS = new Set(['q', 'query', 'search', 'filter', 'keyword', 'keywords', 'term'])

  for (const op of nodes) {
    if (op.method !== 'GET') continue
    const hasSearch = op.parameters.some(p => SEARCH_PARAMS.has(p.name.toLowerCase()))
    if (!hasSearch) continue

    // Find detail operations this search connects to
    const outEdges = edges.filter(e => e.sourceId === op.id)
    for (const edge of outEdges) {
      const target = nodes.find(n => n.id === edge.targetId)
      if (!target || target.method !== 'GET' || !hasPathParams(target.path)) continue

      const resourceName = getBasePath(target.path).split('/').filter(Boolean).pop() || 'resource'

      // Avoid duplicating browse workflows
      if (!hasPathParams(op.path)) {
        workflows.push({
          id: nextId(),
          name: `Search ${resourceName}`,
          description: `Search for ${resourceName} then view details.`,
          pattern: WorkflowPattern.SearchDetail,
          steps: [
            makeStep(op.id, 'search'),
            makeStep(target.id, 'detail', edge),
          ],
          confidence: Math.min(edge.score + 0.2, 1.0),
        })
      }
    }
  }

  return workflows
}

/**
 * Detect Create→Get workflows: POST creates, GET retrieves with returned ID.
 */
function detectCreateThenGetWorkflows(graph: OperationGraph): Workflow[] {
  const workflows: Workflow[] = []
  const { nodes, edges } = graph

  for (const op of nodes) {
    if (op.method !== 'POST') continue

    const outEdges = edges.filter(e => e.sourceId === op.id)
    for (const edge of outEdges) {
      const target = nodes.find(n => n.id === edge.targetId)
      if (!target || target.method !== 'GET' || !hasPathParams(target.path)) continue

      // Must have binding (ID flows from POST response to GET path param)
      if (edge.bindings.length === 0) continue

      const resourceName = getBasePath(target.path).split('/').filter(Boolean).pop() || 'resource'

      workflows.push({
        id: nextId(),
        name: `Create & view ${resourceName}`,
        description: `Create a new ${resourceName} then retrieve it by the returned ID.`,
        pattern: WorkflowPattern.CreateThenGet,
        steps: [
          makeStep(op.id, 'create'),
          makeStep(target.id, 'detail', edge),
        ],
        confidence: Math.min(edge.score + 0.2, 1.0),
      })
    }
  }

  return workflows
}

/**
 * Deduplicate workflows that share the same set of operation IDs.
 * Keeps the one with higher confidence.
 */
function deduplicateWorkflows(workflows: Workflow[]): Workflow[] {
  const seen = new Map<string, Workflow>()

  for (const wf of workflows) {
    const key = wf.steps.map(s => s.operationId).sort().join(',')
    const existing = seen.get(key)
    if (!existing || wf.confidence > existing.confidence) {
      seen.set(key, wf)
    }
  }

  return Array.from(seen.values())
}

/**
 * Extract named workflows from the operation graph.
 */
export function inferWorkflows(graph: OperationGraph): Workflow[] {
  const workflows: Workflow[] = [
    ...detectBrowseWorkflows(graph),
    ...detectCRUDWorkflows(graph),
    ...detectSearchDetailWorkflows(graph),
    ...detectCreateThenGetWorkflows(graph),
  ]

  // Deduplicate and sort by confidence
  const deduped = deduplicateWorkflows(workflows)
  deduped.sort((a, b) => b.confidence - a.confidence)

  return deduped
}

/**
 * Backward chain from a goal operation to find minimal compositions.
 * Returns a workflow that produces the inputs needed by the goal operation,
 * or null if no composition is found.
 */
export function findWorkflowTo(
  graph: OperationGraph,
  goalOperationId: string,
  maxDepth = 3,
): Workflow | null {
  const { nodes, edges } = graph
  const goalOp = nodes.find(n => n.id === goalOperationId)
  if (!goalOp) return null

  // Find all edges leading into the goal
  const inEdges = edges.filter(e => e.targetId === goalOperationId)
  if (inEdges.length === 0) return null

  // Take the best incoming edge
  const bestEdge = inEdges.reduce((a, b) => a.score > b.score ? a : b)
  const sourceOp = nodes.find(n => n.id === bestEdge.sourceId)
  if (!sourceOp) return null

  const steps: WorkflowStep[] = [
    makeStep(sourceOp.id, 'prerequisite'),
    makeStep(goalOp.id, 'goal', bestEdge),
  ]

  // Optionally chain deeper
  if (maxDepth > 1) {
    const deeperInEdges = edges.filter(e => e.targetId === sourceOp.id)
    if (deeperInEdges.length > 0) {
      const deeperEdge = deeperInEdges.reduce((a, b) => a.score > b.score ? a : b)
      const deeperOp = nodes.find(n => n.id === deeperEdge.sourceId)
      if (deeperOp) {
        steps.unshift(makeStep(deeperOp.id, 'prerequisite'))
      }
    }
  }

  return {
    id: nextId(),
    name: `Reach ${goalOp.id}`,
    description: `Steps to prepare inputs for ${goalOp.id}.`,
    pattern: WorkflowPattern.Custom,
    steps,
    confidence: bestEdge.score,
  }
}
