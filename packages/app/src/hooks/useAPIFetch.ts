import { useAppStore, UrlMode } from '../store/appStore'
import { useConfigStore } from '../store/configStore'
import { fetchWithAuth, credentialToAuth, type FetchOptions } from '../services/api/fetcher'
import { inferSchema } from '../services/schema/inferrer'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { Operation } from '@api2aux/semantic-analysis'
import {
  executeOperation,
  executeOperationStream,
  buildRequest,
  parseGraphQLSchema,
  parseRawUrls,
  hasGraphQLErrors,
  getGraphQLErrors,
  isSpecUrl,
  isSpecContent,
  isGraphQLUrl,
} from 'api-invoke'
import type { BuiltRequest, SSEEvent, RawEndpoint } from 'api-invoke'
import * as yaml from 'js-yaml'
import { useAuthStore } from '../store/authStore'
import { GraphQLError } from '../services/api/errors'
import { proxy } from '../services/api/proxy'

/** Try to interpret `data` as a parsed spec object, including YAML string fallback. */
function asSpecCandidate(data: unknown): Record<string, unknown> | null {
  if (isSpecContent(data)) return data
  if (typeof data !== 'string') return null
  try {
    const parsed = yaml.load(data, { schema: yaml.JSON_SCHEMA })
    if (isSpecContent(parsed)) return parsed
  } catch (e) {
    console.warn('[useAPIFetch] YAML spec probe failed:', e instanceof Error ? e.message : e)
  }
  return null
}

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
   * Fetch and parse an OpenAPI spec URL
   */
  const fetchSpec = async (url: string) => {
    try {
      startFetch()
      // Fetch spec ourselves to avoid swagger-parser's Node.js HTTP resolver
      // which uses Buffer (unavailable in browser).
      // Route through CORS proxy so specs without CORS headers still load.
      const specAccept = 'application/json, application/x-yaml, text/yaml, */*'
      const proxyResult = proxy.onRequest
        ? await proxy.onRequest(url, { headers: { Accept: specAccept } })
        : { url, init: { headers: { Accept: specAccept } } }
      const response = await fetch(proxyResult.url, proxyResult.init)
      if (!response.ok) {
        throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`)
      }
      const text = await response.text()
      let specObject: object
      try {
        const parsed = JSON.parse(text)
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('JSON content is not an object')
        }
        specObject = parsed
      } catch (jsonErr) {
        console.warn('[useAPIFetch] JSON parse failed, attempting YAML:', jsonErr instanceof Error ? jsonErr.message : jsonErr)
        try {
          const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA })
          if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('YAML content is not an object')
          }
          specObject = parsed
        } catch (yamlErr) {
          const jsonMsg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr)
          const yamlMsg = yamlErr instanceof Error ? yamlErr.message : String(yamlErr)
          throw new Error(`Failed to parse spec as JSON (${jsonMsg}) or YAML (${yamlMsg})`)
        }
      }
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
      // Clear previous results before starting a new fetch
      clearFieldConfigs()
      clearSpec()

      const mode = useAppStore.getState().urlMode

      // Forced modes skip all detection
      if (mode === UrlMode.SPEC) {
        await fetchSpec(url)
        return
      }
      if (mode === UrlMode.GRAPHQL) {
        await fetchGraphQL(url)
        return
      }

      // Auto mode: URL-based detection
      if (mode === UrlMode.AUTO) {
        if (isGraphQLUrl(url)) {
          await fetchGraphQL(url)
          return
        }
        if (isSpecUrl(url)) {
          await fetchSpec(url)
          return
        }
      }

      // Endpoint mode or Auto mode with no URL match — fetch raw data
      startFetch()

      const data = await fetchWithAuth(url, options)

      // Content-based spec detection fallback (Auto mode only)
      if (mode === UrlMode.AUTO) {
        const specCandidate = asSpecCandidate(data)
        if (specCandidate) {
          const spec = await parseOpenAPISpec(specCandidate, { specUrl: url })
          specSuccess(spec)
          return
        }
      }

      const schema = inferSchema(data, url)
      fetchSuccess(data, schema)
    } catch (error) {
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

  /**
   * Parse multiple raw endpoints into a ParsedAPI spec (no data fetching).
   * Data fetching happens per-operation via fetchOperation when the user selects one.
   */
  const fetchMultiEndpoints = () => {
    const { url, httpMethod, additionalEndpoints } = useAppStore.getState()
    const endpoints: RawEndpoint[] = [
      { url, method: httpMethod },
      ...additionalEndpoints.map(ep => ({ url: ep.url, method: ep.method })),
    ]
    clearFieldConfigs()
    try {
      startFetch()
      const spec = parseRawUrls(endpoints)
      specSuccess(spec)
    } catch (error) {
      fetchError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { fetchAndInfer, fetchSpec, fetchGraphQL, fetchOperation, fetchOperationStream, fetchMultiEndpoints, previewRequest }
}
