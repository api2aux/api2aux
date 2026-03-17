/**
 * Hook that wraps runtime discovery with React state/lifecycle.
 * Exposes a discover() trigger, progress state, and caches results per spec.
 */

import { useState, useCallback, useRef } from 'react'
import type { RuntimeProbeResult, OperationEdge } from '@api2aux/workflow-inference'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { executeOperation } from 'api-invoke'
import { credentialToAuth } from '../services/api/fetcher'
import { proxy } from '../services/api/proxy'
import { useAuthStore } from '../store/authStore'
import { discoverRuntimeEdges } from '../services/discovery/runtimeDiscovery'

export interface DiscoveryProgress {
  status: 'idle' | 'running' | 'done' | 'error'
  completed: number
  total: number
  currentPath?: string
  error?: string
}

export interface RuntimeDiscoveryResult {
  probeResults: RuntimeProbeResult[]
  edges: OperationEdge[]
  probesAttempted: number
  probesSucceeded: number
}

/** Cache key from spec identity. */
function specKey(spec: ParsedAPI): string {
  return `${spec.title}::${spec.version}::${spec.baseUrl}::${spec.operations.length}`
}

/** Session storage key prefix. */
const CACHE_PREFIX = 'runtime-discovery:'

/** Read cached result from sessionStorage. */
function getCached(key: string): RuntimeDiscoveryResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as RuntimeDiscoveryResult
  } catch {
    return null
  }
}

/** Write result to sessionStorage. */
function setCache(key: string, result: RuntimeDiscoveryResult): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result))
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

export function useRuntimeDiscovery(parsedSpec: ParsedAPI | null) {
  const [progress, setProgress] = useState<DiscoveryProgress>({ status: 'idle', completed: 0, total: 0 })
  const [result, setResult] = useState<RuntimeDiscoveryResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Check cache on spec change
  const cachedKey = parsedSpec ? specKey(parsedSpec) : null
  if (cachedKey && !result) {
    const cached = getCached(cachedKey)
    if (cached) {
      // Restore from cache without triggering re-render loop
      // (will be set on first render via lazy init or effect)
      if (progress.status === 'idle' && cached.edges.length > 0) {
        // Use a ref-based approach to avoid render loop
        setTimeout(() => {
          setResult(cached)
          setProgress({ status: 'done', completed: cached.probesAttempted, total: cached.probesAttempted })
        }, 0)
      }
    }
  }

  const discover = useCallback(async () => {
    if (!parsedSpec || parsedSpec.operations.length === 0) return

    // Cancel any in-flight discovery
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setProgress({ status: 'running', completed: 0, total: 0 })
    setResult(null)

    try {
      const baseUrl = parsedSpec.baseUrl
      const opById = new Map(parsedSpec.operations.map(o => [o.id, o]))

      const discoveryResult = await discoverRuntimeEdges(
        parsedSpec.operations,
        async (operationId, args) => {
          const op = opById.get(operationId)
          if (!op) throw new Error(`Operation not found: ${operationId}`)

          const credential = useAuthStore.getState().getActiveCredential(baseUrl)
          const execResult = await executeOperation(baseUrl, op, args, {
            auth: credential ? credentialToAuth(credential) : undefined,
            middleware: [proxy],
          })
          return execResult.data
        },
        {
          signal: controller.signal,
          onProgress: (completed, total, current) => {
            setProgress({ status: 'running', completed, total, currentPath: current.path })
          },
        },
      )

      const finalResult: RuntimeDiscoveryResult = {
        probeResults: discoveryResult.probeResults,
        edges: discoveryResult.edges,
        probesAttempted: discoveryResult.probesAttempted,
        probesSucceeded: discoveryResult.probesSucceeded,
      }

      setResult(finalResult)
      setProgress({
        status: 'done',
        completed: discoveryResult.probesAttempted,
        total: discoveryResult.probesAttempted,
      })

      // Cache result
      const key = specKey(parsedSpec)
      setCache(key, finalResult)
    } catch (err) {
      if (controller.signal.aborted) return
      setProgress({
        status: 'error',
        completed: 0,
        total: 0,
        error: err instanceof Error ? err.message : 'Discovery failed',
      })
    }
  }, [parsedSpec])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setProgress(prev => prev.status === 'running'
      ? { ...prev, status: 'done' }
      : prev
    )
  }, [])

  return {
    progress,
    result,
    probeResults: result?.probeResults ?? null,
    edges: result?.edges ?? null,
    discover,
    cancel,
  }
}
