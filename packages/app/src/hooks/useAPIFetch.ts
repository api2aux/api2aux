import { useAppStore } from '../store/appStore'
import { useConfigStore } from '../store/configStore'
import { fetchWithAuth, type FetchOptions } from '../services/api/fetcher'
import { inferSchema } from '../services/schema/inferrer'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { Operation } from '@api2aux/semantic-analysis'

/**
 * Hook that provides a function to fetch and infer schema from a URL.
 * The function orchestrates: fetchWithAuth -> inferSchema -> store update.
 */
export function useAPIFetch() {
  const { startFetch, fetchSuccess, fetchError, specSuccess, clearSpec } = useAppStore()
  const { clearFieldConfigs } = useConfigStore()

  /**
   * Heuristic to detect if a URL points to an OpenAPI/Swagger spec
   */
  const isSpecUrl = (url: string): boolean => {
    const lower = url.toLowerCase()
    return (
      lower.endsWith('/openapi.json') ||
      lower.endsWith('/openapi.yaml') ||
      lower.endsWith('/swagger.json') ||
      lower.endsWith('/swagger.yaml') ||
      lower.endsWith('/api-docs') ||
      lower.endsWith('/v2/api-docs') ||
      lower.endsWith('/v3/api-docs') ||
      lower.includes('swagger') ||
      lower.includes('openapi')
    )
  }

  /**
   * Fetch and parse an OpenAPI spec URL
   */
  const fetchSpec = async (url: string) => {
    try {
      startFetch()
      // Fetch spec ourselves to avoid swagger-parser's Node.js HTTP resolver
      // which uses Buffer (unavailable in browser)
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`)
      }
      const specObject = await response.json()
      const spec = await parseOpenAPISpec(specObject)
      specSuccess(spec)
    } catch (error) {
      if (error instanceof Error) {
        fetchError(error)
      } else {
        fetchError(new Error(String(error)))
      }
    }
  }

  /**
   * Fetch data from an OpenAPI operation with parameters
   */
  const fetchOperation = async (
    baseUrl: string,
    operation: Operation,
    params: Record<string, string>,
    bodyJson?: string
  ) => {
    try {
      startFetch()

      // Build full URL starting with base + path
      let fullUrl = baseUrl + operation.path

      // Replace path parameters: {paramName} -> value
      for (const param of operation.parameters) {
        const value = params[param.name]
        if (param.in === 'path' && value) {
          fullUrl = fullUrl.replace(`{${param.name}}`, encodeURIComponent(value))
        }
      }

      // Append query parameters
      const queryParams = new URLSearchParams()
      for (const param of operation.parameters) {
        const value = params[param.name]
        if (param.in === 'query' && value) {
          queryParams.append(param.name, value)
        }
      }

      if (queryParams.toString()) {
        fullUrl += '?' + queryParams.toString()
      }

      // Fetch data from the built URL
      const data = await fetchWithAuth(fullUrl, {
        method: operation.method,
        body: bodyJson,
      })

      // Infer schema from response
      const schema = inferSchema(data, fullUrl)

      // Store success result
      fetchSuccess(data, schema)
    } catch (error) {
      if (error instanceof Error) {
        fetchError(error)
      } else {
        fetchError(new Error(String(error)))
      }
    }
  }

  const fetchAndInfer = async (url: string, options?: FetchOptions) => {
    try {
      // Clear stale field configs from previous schema
      clearFieldConfigs()

      // Detect if this is a spec URL
      if (isSpecUrl(url)) {
        await fetchSpec(url)
        return
      }

      // Clear any previous spec (switching from spec to direct URL)
      clearSpec()

      // Signal start of fetch
      startFetch()

      // Fetch raw data from API
      const data = await fetchWithAuth(url, options)

      // Infer schema from data
      const schema = inferSchema(data, url)

      // Store success result
      fetchSuccess(data, schema)
    } catch (error) {
      // Store error
      if (error instanceof Error) {
        fetchError(error)
      } else {
        fetchError(new Error(String(error)))
      }
    }
  }

  return { fetchAndInfer, fetchSpec, fetchOperation }
}
