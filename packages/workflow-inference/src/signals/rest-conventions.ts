/**
 * REST Convention Signal — detects common REST patterns.
 *
 * Patterns detected:
 * - List → Detail: GET /resources + GET /resources/{id}
 * - CRUD: same base path with POST + GET-detail + PUT/PATCH + DELETE
 * - Create → Get: POST response likely returns ID, chains to GET-detail
 *
 * Scoring:
 * - List→Detail: 0.95
 * - CRUD group: 0.90
 * - Create→Get: 0.85
 */

import { BuiltInSignal } from '../types'
import type { InferenceOperation, OperationEdge, EdgeSignal, DataBinding } from '../types'

const SIGNAL_NAME = BuiltInSignal.RestConventions
const SIGNAL_WEIGHT = 0.25

/** Extract the base path by stripping the trailing {param} segment. */
function getBasePath(path: string): string {
  return path.replace(/\/\{[^}]+\}$/, '') || '/'
}

/** Count path parameter segments in a path. */
function countPathParams(path: string): number {
  return (path.match(/\{[^}]+\}/g) || []).length
}

/**
 * Infer the best sourceField for a binding from source → target.
 * Tries to match a target path param name against response fields of the source.
 * Falls back to 'id' if no match found (common REST convention).
 */
function inferSourceField(sourceOp: InferenceOperation, targetParam: string): string {
  if (sourceOp.responseFields.length === 0) return 'id'

  // Exact match (e.g., target param 'userId' matches response field 'userId')
  const exact = sourceOp.responseFields.find(f => f.name === targetParam)
  if (exact) return exact.name

  // Match by ID suffix: target param 'user_id' matches response field 'id'
  // Use regex to avoid false positives like 'valid', 'grid', 'paid'
  const paramLower = targetParam.toLowerCase()
  if (paramLower === 'id' || /[_-]id$/.test(paramLower) || /[a-z]Id$/.test(targetParam)) {
    const idField = sourceOp.responseFields.find(f =>
      f.name === 'id' || f.name === '_id' ||
      f.type === 'integer' && (f.name === 'id' || f.name === targetParam)
    )
    if (idField) return idField.name
  }

  return 'id'
}

/**
 * Build path param bindings from source to target, inferring source fields.
 */
function buildPathBindings(
  sourceOp: InferenceOperation,
  targetOp: InferenceOperation,
  confidence: number,
): DataBinding[] {
  const detailPathParams = targetOp.parameters.filter(p => p.in === 'path')
  return detailPathParams.map(p => ({
    sourceField: inferSourceField(sourceOp, p.name),
    targetParam: p.name,
    targetParamIn: 'path' as const,
    confidence,
  }))
}

/**
 * REST Convention signal: detect list/detail, CRUD, and create-then-get patterns.
 * Groups operations by base path and detects method combinations.
 * Handles nested resources (e.g., /repos/{owner}/{repo}/issues/{issue_number}).
 */
export function detectRestConventions(operations: InferenceOperation[]): OperationEdge[] {
  const edges: OperationEdge[] = []

  // Group operations by base path (path with trailing {param} stripped)
  const groups = new Map<string, InferenceOperation[]>()
  for (const op of operations) {
    const base = getBasePath(op.path)
    const list = groups.get(base) || []
    list.push(op)
    groups.set(base, list)
  }

  for (const [basePath, ops] of groups) {
    const baseParamCount = countPathParams(basePath)

    // List: GET at the base path (same number of params as base)
    const listOp = ops.find(o => o.method === 'GET' && countPathParams(o.path) === baseParamCount)
    // Detail: GET with one more param than base
    const detailOp = ops.find(o => o.method === 'GET' && countPathParams(o.path) > baseParamCount)
    // Create: POST at the base path
    const createOp = ops.find(o => o.method === 'POST' && countPathParams(o.path) === baseParamCount)
    // Update: PUT/PATCH with more params
    const updateOp = ops.find(o => (o.method === 'PUT' || o.method === 'PATCH') && countPathParams(o.path) > baseParamCount)
    // Delete: DELETE with more params
    const deleteOp = ops.find(o => o.method === 'DELETE' && countPathParams(o.path) > baseParamCount)

    // List → Detail
    if (listOp && detailOp) {
      const signal: EdgeSignal = {
        signal: SIGNAL_NAME,
        weight: SIGNAL_WEIGHT,
        matched: true,
        detail: `List→Detail: ${listOp.path} → ${detailOp.path}`,
      }

      const bindings = buildPathBindings(listOp, detailOp, 0.95)

      edges.push({
        sourceId: listOp.id,
        targetId: detailOp.id,
        bindings,
        score: 0.95 * SIGNAL_WEIGHT,
        signals: [signal],
      })
    }

    // Create → Detail (POST creates, then GET retrieves)
    if (createOp && detailOp) {
      const signal: EdgeSignal = {
        signal: SIGNAL_NAME,
        weight: SIGNAL_WEIGHT,
        matched: true,
        detail: `Create→Get: ${createOp.path} → ${detailOp.path}`,
      }

      const bindings = buildPathBindings(createOp, detailOp, 0.85)

      edges.push({
        sourceId: createOp.id,
        targetId: detailOp.id,
        bindings,
        score: 0.85 * SIGNAL_WEIGHT,
        signals: [signal],
      })
    }

    // Create → Update (POST creates, then PUT/PATCH modifies)
    if (createOp && updateOp) {
      const signal: EdgeSignal = {
        signal: SIGNAL_NAME,
        weight: SIGNAL_WEIGHT,
        matched: true,
        detail: `Create→Update: ${createOp.path} → ${updateOp.path}`,
      }

      const bindings = buildPathBindings(createOp, updateOp, 0.85)

      edges.push({
        sourceId: createOp.id,
        targetId: updateOp.id,
        bindings,
        score: 0.85 * SIGNAL_WEIGHT,
        signals: [signal],
      })
    }

    // Detail → Update
    if (detailOp && updateOp) {
      const signal: EdgeSignal = {
        signal: SIGNAL_NAME,
        weight: SIGNAL_WEIGHT,
        matched: true,
        detail: `Detail→Update: ${detailOp.path} → ${updateOp.path}`,
      }

      edges.push({
        sourceId: detailOp.id,
        targetId: updateOp.id,
        bindings: [],
        score: 0.80 * SIGNAL_WEIGHT,
        signals: [signal],
      })
    }

    // Detail → Delete
    if (detailOp && deleteOp) {
      const signal: EdgeSignal = {
        signal: SIGNAL_NAME,
        weight: SIGNAL_WEIGHT,
        matched: true,
        detail: `Detail→Delete: ${detailOp.path} → ${deleteOp.path}`,
      }

      edges.push({
        sourceId: detailOp.id,
        targetId: deleteOp.id,
        bindings: [],
        score: 0.80 * SIGNAL_WEIGHT,
        signals: [signal],
      })
    }
  }

  return edges
}
