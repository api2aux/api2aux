/**
 * Hook that wraps runtime discovery with React state/lifecycle.
 * Exposes a discover() trigger, progress state, and caches results per spec.
 */

import { useState, useCallback, useRef, useEffect, startTransition } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { executeOperation } from 'api-invoke'
import { credentialToAuth } from '../services/api/fetcher'
import { proxy } from '../services/api/proxy'
import { useAuthStore } from '../store/authStore'
import { discoverRuntimeEdges } from '../services/discovery/runtimeDiscovery'
import type { DiscoveryResult } from '../services/discovery/runtimeDiscovery'

export type DiscoveryProgress =
  | { status: 'idle' }
  | { status: 'running'; completed: number; total: number; currentPath?: string }
  | { status: 'done'; completed: number; total: number }
  | { status: 'error'; error: string; completed: number; total: number }

/** Simple hash for cache key collision resistance. */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/** Cache key from spec identity. */
function specKey(spec: ParsedAPI): string {
  const opsFingerprint = simpleHash(spec.operations.map(o => o.id).join(','))
  return `${spec.title}::${spec.version}::${spec.baseUrl}::${spec.operations.length}::${opsFingerprint}`
}

/** Session storage key prefix. */
const CACHE_PREFIX = 'runtime-discovery:'

/** Read cached result from sessionStorage. */
function getCached(key: string): DiscoveryResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as DiscoveryResult
  } catch (err) {
    console.warn('[runtime-discovery] Cache read failed:', err)
    return null
  }
}

/** Write result to sessionStorage. */
function setCache(key: string, result: DiscoveryResult): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result))
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.debug('[runtime-discovery] Cache write skipped: sessionStorage quota exceeded')
      return
    }
    console.warn('[runtime-discovery] Cache write failed:', err)
  }
}

export function useRuntimeDiscovery(parsedSpec: ParsedAPI | null) {
  const [progress, setProgress] = useState<DiscoveryProgress>({ status: 'idle' })
  const [result, setResult] = useState<DiscoveryResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cachedKey = parsedSpec ? specKey(parsedSpec) : null

  // Restore from cache or reset when spec changes; cancel any in-flight discovery
  useEffect(() => {
    abortRef.current?.abort()
    startTransition(() => {
      if (!cachedKey) {
        setResult(null)
        setProgress({ status: 'idle' })
        return
      }
      const cached = getCached(cachedKey)
      if (cached && cached.edges.length > 0) {
        setResult(cached)
        setProgress({ status: 'done', completed: cached.probesAttempted, total: cached.probesAttempted })
      } else {
        setResult(null)
        setProgress({ status: 'idle' })
      }
    })
  }, [cachedKey])

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

      setResult(discoveryResult)
      setProgress({
        status: 'done',
        completed: discoveryResult.probesAttempted,
        total: discoveryResult.probesAttempted,
      })

      // Cache result
      const key = specKey(parsedSpec)
      setCache(key, discoveryResult)
    } catch (err) {
      if (controller.signal.aborted) return
      setProgress(prev => ({
        status: 'error',
        completed: prev.status === 'running' ? prev.completed : 0,
        total: prev.status === 'running' ? prev.total : 0,
        error: err instanceof Error ? err.message : 'Discovery failed',
      }))
    }
  }, [parsedSpec])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setResult(null)
    setProgress({ status: 'idle' })
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
