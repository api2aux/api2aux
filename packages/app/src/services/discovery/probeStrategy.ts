/**
 * Probe strategy — selects which endpoints to call for runtime discovery.
 *
 * Budget: max N probes (default 10). GET only (no side effects).
 * Priority: zero-param GETs (list endpoints) > enum-param GETs > example-param GETs.
 */

import type { InferenceOperation } from '@api2aux/workflow-inference'

export interface ProbeSpec {
  operationId: string
  path: string
  /** Param values to fill for this probe. Empty for zero-param endpoints. */
  args: Record<string, string | number>
}

/** Score an operation for probing priority. Higher = probe first. */
function probeScore(op: InferenceOperation): number {
  if (op.method !== 'GET') return -1

  let score = 2 // Base score for GET

  const pathParams = op.parameters.filter(p => p.in === 'path' && p.required)
  if (pathParams.length === 0) {
    score += 3 // No required path params = cheapest to call
  }

  if (op.responseFields.length > 0) {
    score += 1 // Has response schema = more likely to return useful structure
  }

  if (op.responseFields.length > 3) {
    score += 1 // Many response fields = more values to extract
  }

  return score
}

/** Check if we can fill all required path params from enum/example values. */
function canFillParams(op: InferenceOperation): Record<string, string | number> | null {
  const args: Record<string, string | number> = {}
  const requiredPathParams = op.parameters.filter(p => p.in === 'path' && p.required)

  for (const param of requiredPathParams) {
    if (param.enum && param.enum.length > 0) {
      const first = param.enum[0]
      if (typeof first === 'string' || typeof first === 'number') {
        args[param.name] = first
        continue
      }
    }
    if (param.example !== undefined) {
      if (typeof param.example === 'string' || typeof param.example === 'number') {
        args[param.name] = param.example
        continue
      }
    }
    return null // Can't fill this param
  }

  return args
}

/** Extract the resource group from a path (first 2 non-param segments). */
function resourceGroup(path: string): string {
  return path
    .split('/')
    .filter(s => s && !s.startsWith('{'))
    .slice(0, 2)
    .join('/')
}

type Candidate = { op: InferenceOperation; score: number; args: Record<string, string | number> }

/**
 * Select which endpoints to probe, respecting the budget.
 *
 * Prioritizes diversity across resource groups: picks at most one list
 * endpoint and one detail endpoint per resource before filling remaining
 * slots. This prevents one resource's sub-endpoints from dominating.
 */
export function selectProbes(
  operations: InferenceOperation[],
  maxProbes = 10,
): ProbeSpec[] {
  const candidates: Candidate[] = []

  for (const op of operations) {
    const score = probeScore(op)
    if (score < 0) continue // Not a GET

    const args = canFillParams(op)
    if (args === null) continue // Can't fill required params

    candidates.push({ op, score, args })
  }

  // Group by resource
  const groups = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const group = resourceGroup(c.op.path)
    const list = groups.get(group) ?? []
    list.push(c)
    groups.set(group, list)
  }

  // Sort within each group by score descending
  for (const list of groups.values()) {
    list.sort((a, b) => b.score - a.score || a.op.path.localeCompare(b.op.path))
  }

  // Round-robin: pick the best candidate from each group, repeating
  // until budget is filled. This ensures diverse resource coverage.
  const selected: Candidate[] = []
  const groupKeys = Array.from(groups.keys()).sort()
  const groupIndexes = new Map(groupKeys.map(k => [k, 0]))

  while (selected.length < maxProbes) {
    let pickedAny = false
    for (const key of groupKeys) {
      if (selected.length >= maxProbes) break
      const list = groups.get(key)!
      const idx = groupIndexes.get(key)!
      if (idx < list.length) {
        selected.push(list[idx]!)
        groupIndexes.set(key, idx + 1)
        pickedAny = true
      }
    }
    if (!pickedAny) break // All groups exhausted
  }

  return selected.map(c => ({
    operationId: c.op.id,
    path: c.op.path,
    args: c.args,
  }))
}
