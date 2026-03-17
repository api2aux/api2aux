/**
 * Runtime discovery orchestrator — probes endpoints and discovers edges.
 *
 * Accepts an executeFn callback (caller provides auth/proxy) so the
 * discovery service has no direct dependency on api-invoke or auth stores.
 */

import type { RuntimeProbeResult, OperationEdge, InferenceOperation } from '@api2aux/workflow-inference'
import { operationsToInference, matchRuntimeValues } from '@api2aux/workflow-inference'
import type { ProbeSpec } from './probeStrategy'
import { selectProbes } from './probeStrategy'
import { extractProbeValues } from './valueExtractor'

export interface DiscoveryOptions {
  /** Max probes to make (default 20). */
  maxProbes?: number
  /** Abort signal for cancellation. */
  signal?: AbortSignal
  /** Progress callback: called after each probe. */
  onProgress?: (completed: number, total: number, current: ProbeSpec) => void
}

export interface DiscoveryResult {
  probeResults: RuntimeProbeResult[]
  edges: OperationEdge[]
  probesAttempted: number
  probesSucceeded: number
}

/**
 * Execute function signature: caller provides a function that
 * executes an operation by ID with given args and returns the response data.
 */
export type ExecuteFn = (
  operationId: string,
  args: Record<string, string | number>,
) => Promise<unknown>

/**
 * Discover runtime edges by probing endpoints.
 *
 * @param operations - Source operations (api-invoke format, pre-conversion)
 * @param executeFn - Caller-provided function to execute an operation
 * @param options - Discovery options
 * @returns Probe results and discovered edges
 */
export async function discoverRuntimeEdges(
  operations: Array<{ id: string; path: string; method: string; tags: string[]; summary?: string; parameters: Array<{ name: string; in: string; required: boolean; schema: { type: string; format?: string; enum?: unknown[]; example?: unknown } }>; responseSchema?: unknown; requestBody?: unknown }>,
  executeFn: ExecuteFn,
  options?: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const inferenceOps = operationsToInference(operations)
  return discoverRuntimeEdgesFromInference(inferenceOps, executeFn, options)
}

/**
 * Discover edges using pre-converted InferenceOperations.
 * Core implementation — discoverRuntimeEdges delegates here after conversion.
 */
export async function discoverRuntimeEdgesFromInference(
  inferenceOps: InferenceOperation[],
  executeFn: ExecuteFn,
  options?: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const maxProbes = options?.maxProbes ?? 20
  const signal = options?.signal

  const probes = selectProbes(inferenceOps, maxProbes)

  const probeResults: RuntimeProbeResult[] = []
  let probesSucceeded = 0

  for (const probe of probes) {
    if (signal?.aborted) break
    options?.onProgress?.(probeResults.length, probes.length, probe)

    try {
      const data = await executeFn(probe.operationId, probe.args)
      let values: ReturnType<typeof extractProbeValues> = []
      try {
        values = extractProbeValues(data)
      } catch (extractErr) {
        console.warn(`[runtime-discovery] Value extraction failed for ${probe.operationId}:`, extractErr instanceof Error ? extractErr.message : extractErr)
        values = []
      }
      probeResults.push({ operationId: probe.operationId, values, success: true })
      probesSucceeded++
    } catch (err) {
      console.warn(`[runtime-discovery] Probe failed for ${probe.operationId}:`, err instanceof Error ? err.message : err)
      probeResults.push({ operationId: probe.operationId, values: [], success: false })
    }
  }

  const edges = matchRuntimeValues(probeResults, inferenceOps)

  return { probeResults, edges, probesAttempted: probeResults.length, probesSucceeded }
}
