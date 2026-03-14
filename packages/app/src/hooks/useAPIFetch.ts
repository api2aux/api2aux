import { useAppStore } from '../store/appStore'
import { useConfigStore } from '../store/configStore'
import { fetchWithAuth, credentialToAuth, type FetchOptions } from '../services/api/fetcher'
import { inferSchema } from '../services/schema/inferrer'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { Operation } from '@api2aux/semantic-analysis'
import {
  executeOperation,
  executeOperationStream,
  buildRequest,
  corsProxy,
  parseGraphQLSchema,
  hasGraphQLErrors,
  getGraphQLErrors,
} from 'api-invoke'
import type { BuiltRequest, SSEEvent } from 'api-invoke'
import { useAuthStore } from '../store/authStore'
import { GraphQLError } from '../services/api/errors'

const proxy = corsProxy()

/** Build args for executeOperation, handling buildBody-aware operations (GraphQL). */
function buildArgs(
  params: Record<string, string>,
  bodyJson: string | undefined,
  operation: Operation,
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...params }
  if (bodyJson) {
    const parsed = JSON.parse(bodyJson)
    if (operation.buildBody && typeof parsed === 'object' && parsed !== null) {
      // Operations with buildBody (e.g. GraphQL) expect fields as top-level args
      // so the hook can wrap them into { query, variables }
      Object.assign(args, parsed)
    } else {
      args.body = parsed
    }
  }
  return args
}

/**
 * Hook that provides a function to fetch and infer schema from a URL.
 * The function orchestrates: fetchWithAuth -> inferSchema -> store update.
 */
export function useAPIFetch() {
  const { startFetch, fetchSuccess, fetchError, specSuccess, clearSpec, startStream, appendStreamEvents, streamComplete } = useAppStore()
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
   * Heuristic to detect if fetched JSON content is an OpenAPI/Swagger spec.
   */
  const isSpecContent = (data: unknown): data is Record<string, unknown> => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const obj = data as Record<string, unknown>
    return typeof obj.openapi === 'string' || typeof obj.swagger === 'string'
  }

  /**
   * Heuristic to detect if a URL points to a GraphQL endpoint
   */
  const isGraphQLUrl = (url: string): boolean => {
    try {
      const { pathname } = new URL(url)
      const lower = pathname.toLowerCase()
      return lower.endsWith('/graphql') || lower.endsWith('/gql')
    } catch {
      return false
    }
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
      const spec = await parseOpenAPISpec(specObject, { specUrl: url })
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
   * Fetch and parse a GraphQL endpoint via introspection
   */
  const fetchGraphQL = async (url: string) => {
    try {
      startFetch()
      const spec = await parseGraphQLSchema(url, {
        // Route introspection POST through the CORS proxy
        fetch: async (input, init) => {
          const targetUrl = typeof input === 'string' ? input : (input as Request).url
          const rewritten = proxy.onRequest
            ? (await proxy.onRequest(targetUrl, init ?? {})).url
            : targetUrl
          return fetch(rewritten, init)
        },
      })
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
   * Execute an operation via api-invoke's executeOperation.
   * Handles auth injection, CORS proxy, buildBody hooks (for GraphQL), and error mapping.
   */
  const fetchOperation = async (
    baseUrl: string,
    operation: Operation,
    params: Record<string, string>,
    bodyJson?: string
  ) => {
    try {
      startFetch()

      const credential = useAuthStore.getState().getActiveCredential(baseUrl)
      const args = buildArgs(params, bodyJson, operation)

      const result = await executeOperation(baseUrl, operation, args, {
        auth: credential ? credentialToAuth(credential) : undefined,
        middleware: [proxy],
      })

      // Check for GraphQL-level errors (HTTP 200 but errors in body)
      if (hasGraphQLErrors(result)) {
        const gqlErrors = getGraphQLErrors(result)
        // Partial errors: data + errors — show data with warning
        if (result.data && typeof result.data === 'object' && 'data' in (result.data as Record<string, unknown>) && (result.data as Record<string, unknown>).data !== null) {
          const schema = inferSchema(result.data, `${baseUrl}${operation.path}`)
          fetchSuccess(result.data, schema)
          return
        }
        // Total failure: only errors, no data
        throw new GraphQLError(`${baseUrl}${operation.path}`, gqlErrors)
      }

      // Infer schema from response
      const schema = inferSchema(result.data, `${baseUrl}${operation.path}`)

      // Store success result
      fetchSuccess(result.data, schema)
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

      // Detect GraphQL endpoint
      if (isGraphQLUrl(url)) {
        await fetchGraphQL(url)
        return
      }

      // Detect OpenAPI/Swagger spec URL
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

      // Content-based spec detection fallback: if the response looks like
      // an OpenAPI/Swagger spec (has `openapi` or `swagger` top-level key),
      // parse it as a spec instead of treating it as raw data.
      if (isSpecContent(data)) {
        const spec = await parseOpenAPISpec(data as Record<string, unknown>, { specUrl: url })
        specSuccess(spec)
        return
      }

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

  /**
   * Stream an SSE operation. Batches events via requestAnimationFrame to avoid
   * overwhelming React with per-event re-renders.
   */
  const fetchOperationStream = async (
    baseUrl: string,
    operation: Operation,
    params: Record<string, string>,
    bodyJson?: string,
    signal?: AbortSignal,
  ) => {
    try {
      startStream()

      const credential = useAuthStore.getState().getActiveCredential(baseUrl)
      const args = buildArgs(params, bodyJson, operation)

      const result = await executeOperationStream(baseUrl, operation, args, {
        auth: credential ? credentialToAuth(credential) : undefined,
        middleware: [proxy],
        signal,
      })

      // Batch events with requestAnimationFrame to throttle renders
      let buffer: SSEEvent[] = []
      let rafId: number | null = null

      const flush = () => {
        if (buffer.length > 0) {
          appendStreamEvents(buffer)
          buffer = []
        }
        rafId = null
      }

      for await (const event of result.stream) {
        buffer.push(event)
        if (rafId === null) {
          rafId = requestAnimationFrame(flush)
        }
      }

      // Flush remaining events
      if (rafId !== null) cancelAnimationFrame(rafId)
      flush()
      streamComplete()
    } catch (error) {
      if (signal?.aborted) {
        streamComplete()
        return
      }
      if (error instanceof Error) {
        fetchError(error)
      } else {
        fetchError(new Error(String(error)))
      }
    }
  }

  const previewRequest = (
    baseUrl: string,
    operation: Operation,
    params: Record<string, string>,
    bodyJson?: string
  ): BuiltRequest => {
    const credential = useAuthStore.getState().getActiveCredential(baseUrl)
    const args = buildArgs(params, bodyJson, operation)
    return buildRequest(baseUrl, operation, args, {
      auth: credential ? credentialToAuth(credential) : undefined,
    })
  }

  return { fetchAndInfer, fetchSpec, fetchGraphQL, fetchOperation, fetchOperationStream, previewRequest }
}
