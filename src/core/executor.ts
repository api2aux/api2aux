/**
 * HTTP request execution with body serialization (JSON, form-urlencoded, multipart) and error classification.
 * Pluggable: uses global fetch by default, can be overridden.
 */

import type { Auth, BuiltRequest, ExecutionResult, Middleware, Operation, SSEEvent, StreamingExecutionResult } from './types'
import { ContentType, HeaderName, HttpMethod } from './types'
import { parseSSE } from './sse'
import { buildUrl, extractHeaderParams, extractCookieParams } from './url-builder'
import { injectAuth } from './auth'
import {
  API_INVOKE_ERROR_NAME,
  ErrorKind,
  authError,
  corsError,
  httpError,
  networkError,
  parseError,
  timeoutError,
} from './errors'

const ABORT_ERROR_NAME = 'AbortError'
const OPAQUE_RESPONSE_TYPE = 'opaque'
const NO_CORS_MODE = 'no-cors'
const JSON_SUFFIX = '+json'
const XML_SUBTYPE = '/xml'
const XML_SUFFIX = '+xml'

/**
 * Options for {@link buildRequest} — only request-construction concerns, no runtime/execution options.
 */
export interface BuildRequestOptions {
  /** Authentication credentials to inject into the request. */
  auth?: Auth | Auth[]
  /** Override the Accept header. Defaults to `operation.responseContentType` or `'application/json'`. */
  accept?: string
}

/**
 * Options for {@link executeOperation} and {@link executeOperationStream}.
 * Extends {@link BuildRequestOptions} with runtime and execution concerns.
 */
export interface ExecuteOptions extends BuildRequestOptions {
  /** Middleware pipeline applied to the request/response. */
  middleware?: Middleware[]
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
  /** If false, return ExecutionResult for all HTTP errors instead of throwing. Client-side errors (CORS, network, timeout) always throw regardless. Default: true. */
  throwOnHttpError?: boolean
  /** Timeout in milliseconds. 0 = no timeout (default). */
  timeoutMs?: number
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal
  /** Redirect behavior passed to fetch. Unset by default (fetch implementations typically default to 'follow'). */
  redirect?: RequestInit['redirect']
  /** Extra headers to merge into the request. Applied after buildRequest, so they override spec-derived headers. */
  headers?: Record<string, string>
}

export type { BuiltRequest }

/**
 * Build a request without executing it (dry-run / preview).
 * Validates parameters, assembles the body, and injects auth — but does not send.
 *
 * @param baseUrl - Base URL for the API (e.g. 'https://api.example.com/v1')
 * @param operation - The operation to build a request for
 * @param args - Key-value pairs for path, query, header, and body parameters
 * @param options - Auth and accept header overrides
 * @returns A fully constructed request ready to inspect or send manually
 * @throws {Error} If required parameters are missing
 * @throws {TypeError} If the URL is malformed when using query-based API key auth
 */
export function buildRequest(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  options: BuildRequestOptions = {},
): BuiltRequest {
  // Validate required parameters
  const missing = operation.parameters
    .filter(p => p.required && args[p.name] === undefined)
    .map(p => p.name)
  if (missing.length > 0) {
    throw new Error(
      `Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} for operation "${operation.id}"`
    )
  }

  // Build URL and headers
  let url = buildUrl(baseUrl, operation, args)
  const method = operation.method.toUpperCase()

  const accept = options.accept || operation.responseContentType || ContentType.JSON
  const headers: Record<string, string> = {
    [HeaderName.ACCEPT]: accept,
    ...extractHeaderParams(operation.parameters, args),
  }

  // Inject cookie parameters as Cookie header
  const cookieHeader = extractCookieParams(operation.parameters, args)
  if (cookieHeader) {
    headers[HeaderName.COOKIE] = cookieHeader
  }

  // Assemble body: explicit 'body' arg > buildBody hook (protocol adapters) > flat-arg assembly
  let bodyData = args['body']
  const allowsBody = method !== HttpMethod.GET && method !== HttpMethod.HEAD && method !== HttpMethod.OPTIONS
  if (!bodyData && operation.buildBody && allowsBody) {
    bodyData = operation.buildBody(args)
  } else if (!bodyData && operation.requestBody && allowsBody) {
    const bodyProps = operation.requestBody.schema.properties
    if (bodyProps) {
      const assembled: Record<string, unknown> = {}
      for (const propName of Object.keys(bodyProps)) {
        if (args[propName] !== undefined) {
          assembled[propName] = args[propName]
        }
      }
      if (Object.keys(assembled).length > 0) {
        bodyData = assembled
      }
    }
  }

  // Serialize body based on content type
  let body: string | FormData | undefined
  if (bodyData && allowsBody) {
    const contentType = operation.requestBody?.contentType ?? ContentType.JSON

    if (contentType === ContentType.FORM_URLENCODED) {
      const params = new URLSearchParams()
      const obj = typeof bodyData === 'object' && bodyData !== null ? bodyData as Record<string, unknown> : {}
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value))
        }
      }
      body = params.toString()
      headers[HeaderName.CONTENT_TYPE] = ContentType.FORM_URLENCODED
    } else if (contentType === ContentType.MULTIPART) {
      if (typeof bodyData !== 'object' || bodyData === null) {
        throw new Error(
          `Multipart/form-data body for operation "${operation.id}" must be an object, got ${typeof bodyData}`
        )
      }
      const formData = new FormData()
      const obj = bodyData as Record<string, unknown>
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue
        if (value instanceof Blob) {
          const filename = value instanceof File ? value.name : key
          formData.append(key, value, filename)
        } else if (value instanceof ArrayBuffer) {
          formData.append(key, new Blob([value]), key)
        } else if (ArrayBuffer.isView(value)) {
          formData.append(key, new Blob([new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)]), key)
        } else {
          formData.append(key, String(value))
        }
      }
      body = formData
      // Do NOT set Content-Type — fetch auto-sets it with the multipart boundary
    } else {
      body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData)
      headers[HeaderName.CONTENT_TYPE] = ContentType.JSON
    }
  }

  // Inject auth
  if (options.auth) {
    const authed = injectAuth(url, headers, options.auth)
    url = authed.url
    Object.assign(headers, authed.headers)
  }

  return { method, url, headers, body }
}

/**
 * Shared fetch pipeline: buildRequest → extra headers → abort signal → request middleware → fetch → response middleware.
 * Used by both executeOperation() and executeOperationStream().
 */
async function executeFetch(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  options: ExecuteOptions,
): Promise<{ response: Response; request: BuiltRequest; headers: Record<string, string>; elapsedMs: number }> {
  const fetchFn = options.fetch ?? globalThis.fetch

  let { method, url, headers, body } = buildRequest(baseUrl, operation, args, {
    auth: options.auth,
    accept: options.accept,
  })

  // Merge extra headers (overrides spec-derived headers)
  if (options.headers) {
    Object.assign(headers, options.headers)
  }

  // Build abort signal (timeout + caller signal)
  let signal: AbortSignal | undefined = options.signal
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined

  if (options.timeoutMs && options.timeoutMs > 0) {
    const controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)

    if (options.signal) {
      // Combine caller signal with timeout signal
      abortHandler = () => controller.abort()
      options.signal.addEventListener('abort', abortHandler, { once: true })
    }
    signal = controller.signal
  }

  let init: RequestInit = { method, headers, body, signal, redirect: options.redirect }

  // Apply request middleware
  if (options.middleware) {
    for (const mw of options.middleware) {
      if (mw.onRequest) {
        const result = await mw.onRequest(url, init)
        url = result.url
        init = result.init
      }
    }
  }

  // Execute
  const start = performance.now()
  let response: Response

  try {
    response = await fetchFn(url, init)
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    if (abortHandler && options.signal) options.signal.removeEventListener('abort', abortHandler)

    if (options.middleware) {
      for (const mw of options.middleware) {
        if (mw.onError) {
          const normalized = error instanceof Error ? error : new Error(String(error))
          try { mw.onError(normalized) } catch (mwError) {
            console.warn(`[api-invoke] middleware "${mw.name ?? 'unnamed'}" onError handler threw (suppressed):`, mwError)
          }
        }
      }
    }

    // Abort errors (timeout or caller cancellation)
    if (error instanceof DOMException && error.name === ABORT_ERROR_NAME) {
      if (options.timeoutMs && options.timeoutMs > 0) {
        throw timeoutError(url)
      }
      throw error // Caller-initiated abort — re-throw as-is
    }

    if (error instanceof TypeError) {
      // TypeError: Failed to fetch — CORS or network issue
      // Heuristic: try no-cors to distinguish (browser-only, skip in Node.js)
      if (typeof window !== 'undefined') {
        try {
          const probe = await fetchFn(url, { mode: NO_CORS_MODE })
          if (probe.type === OPAQUE_RESPONSE_TYPE) throw corsError(url)
        } catch (probeError) {
          // Re-throw if the probe identified a CORS error; swallow other probe failures
          if (probeError instanceof Error && probeError.name === API_INVOKE_ERROR_NAME) throw probeError
        }
      }
      throw networkError(url)
    }
    throw networkError(url)
  }

  if (timeoutId) clearTimeout(timeoutId)
  if (abortHandler && options.signal) options.signal.removeEventListener('abort', abortHandler)
  const elapsedMs = Math.round(performance.now() - start)

  // Apply response middleware
  if (options.middleware) {
    for (const mw of options.middleware) {
      if (mw.onResponse) {
        response = await mw.onResponse(response)
      }
    }
  }

  // Collect response headers
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  return { response, request: { method, url, headers, body }, headers: responseHeaders, elapsedMs }
}

/**
 * Execute an API call for an operation with arguments.
 * Builds the URL, injects auth, applies middleware, and classifies errors.
 *
 * @param baseUrl - Base URL for the API
 * @param operation - The operation to execute
 * @param args - Key-value pairs for path, query, header, and body parameters
 * @param options - Execution options (auth, middleware, fetch, timeout, error behavior)
 * @returns The execution result with parsed response data
 * @throws {ApiInvokeError} For network, CORS, timeout, parse, and (by default) HTTP errors
 */
export async function executeOperation(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  options: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const { response, request, headers: responseHeaders, elapsedMs } = await executeFetch(baseUrl, operation, args, options)
  const { method, url, headers, body } = request

  // Parse response body based on content type
  // Handles JSON (including +json variants like application/vnd.api+json), binary, XML, and unknown types (JSON attempted, falling back to text)
  let data: unknown
  const contentType = response.headers.get(HeaderName.CONTENT_TYPE) || ''
  if (contentType.includes(ContentType.JSON) || contentType.includes(JSON_SUFFIX)) {
    const cloned = response.clone()
    try {
      data = await response.json()
    } catch (jsonError) {
      if (options.throwOnHttpError !== false) throw parseError(url)
      console.warn('[api-invoke] JSON parse failed, falling back to text:', jsonError)
      try {
        data = await cloned.text()
      } catch {
        // Body unreadable is a client-side failure — throw even in non-throwing mode
        throw parseError(url)
      }
    }
  } else if (isBinaryContentType(contentType)) {
    try {
      data = await response.arrayBuffer()
    } catch {
      throw parseError(url, 'binary')
    }
  } else if (contentType.includes(XML_SUBTYPE) || contentType.includes(XML_SUFFIX)) {
    try {
      data = await response.text()
    } catch {
      throw parseError(url, 'XML')
    }
  } else {
    let text: string
    try {
      text = await response.text()
    } catch {
      throw parseError(url, 'text')
    }
    // Try JSON parsing for responses without proper content-type
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  const result: ExecutionResult = {
    status: response.status,
    data,
    contentType,
    headers: responseHeaders,
    request: { method, url, headers, body },
    elapsedMs,
  }

  // Check for HTTP errors
  if (options.throwOnHttpError !== false) {
    if (response.status === 401 || response.status === 403) {
      throw authError(url, response.status as 401 | 403, data)
    }
    if (!response.ok) {
      throw httpError(url, response.status, response.statusText, data)
    }
  } else if (!response.ok) {
    // Non-throwing mode: classify the error for programmatic handling
    if (response.status === 401 || response.status === 403) {
      result.errorKind = ErrorKind.AUTH
    } else if (response.status === 429) {
      result.errorKind = ErrorKind.RATE_LIMIT
    } else {
      result.errorKind = ErrorKind.HTTP
    }
  }

  return result
}

/**
 * Execute a raw HTTP request without an API spec (Tier 3: zero spec).
 * Still provides error classification, response parsing, and timing.
 *
 * @param url - Full URL to request
 * @param options - Request options (method, headers, body, auth, middleware)
 * @returns The execution result with parsed response data
 * @throws {ApiInvokeError} For network, CORS, timeout, parse, and (by default) HTTP errors
 */
export async function executeRaw(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    auth?: Auth | Auth[]
    middleware?: Middleware[]
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
    signal?: AbortSignal
    accept?: string
    redirect?: RequestInit['redirect']
  } = {},
): Promise<ExecutionResult> {
  // Create a synthetic operation for the raw request
  const operation: Operation = {
    id: 'raw',
    path: '',
    method: options.method ?? HttpMethod.GET,
    parameters: [],
    tags: [],
  }

  return executeOperation(url, operation, { body: options.body }, {
    auth: options.auth,
    middleware: options.middleware,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    accept: options.accept,
    redirect: options.redirect,
    headers: options.headers,
  })
}

/**
 * Execute an API call and return a streaming async iterable of SSE events.
 * Errors always throw (no non-throwing mode for streams).
 *
 * @param baseUrl - Base URL for the API
 * @param operation - The operation to execute
 * @param args - Key-value pairs for path, query, header, and body parameters
 * @param options - Execution options, plus optional `onEvent` callback for each SSE event
 * @returns Streaming result with an async iterable `stream` property
 * @throws {ApiInvokeError} For network, CORS, timeout, parse, and HTTP errors
 */
export async function executeOperationStream(
  baseUrl: string,
  operation: Operation,
  args: Record<string, unknown>,
  options: ExecuteOptions & { onEvent?: (event: SSEEvent) => void } = {},
): Promise<StreamingExecutionResult> {
  // Default Accept to SSE when not explicitly set
  const streamOptions: ExecuteOptions = {
    ...options,
    accept: options.accept ?? operation.responseContentType ?? ContentType.SSE,
  }

  const { response, request, headers: responseHeaders, elapsedMs } = await executeFetch(baseUrl, operation, args, streamOptions)

  // Always throw on HTTP errors for streams
  if (!response.ok) {
    let body: unknown
    try {
      const text = await response.text()
      try { body = JSON.parse(text) } catch { body = text }
    } catch (readError) {
      body = `[api-invoke: failed to read error response body: ${readError instanceof Error ? readError.message : String(readError)}]`
    }
    if (response.status === 401 || response.status === 403) {
      throw authError(request.url, response.status as 401 | 403, body)
    }
    throw httpError(request.url, response.status, response.statusText, body)
  }

  if (!response.body) {
    throw parseError(request.url, 'SSE (response body is null)')
  }

  const contentType = response.headers.get(HeaderName.CONTENT_TYPE) || ''

  // Warn if the response is not SSE — the server may have ignored the Accept header
  if (contentType && !contentType.includes('text/event-stream')) {
    console.warn(`[api-invoke] Expected content-type text/event-stream but got "${contentType}" — SSE parsing may produce unexpected results`)
  }

  // Wrap SSE parser with optional onEvent callback
  let stream: AsyncIterable<SSEEvent> = parseSSE(response.body)
  if (options.onEvent) {
    const inner = stream
    const onEvent = options.onEvent
    stream = (async function* () {
      for await (const event of inner) {
        try {
          onEvent(event)
        } catch (callbackError) {
          throw new Error(
            `onEvent callback threw for event "${event.event ?? 'message'}": ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`,
            { cause: callbackError },
          )
        }
        yield event
      }
    })()
  }

  return {
    status: response.status,
    stream,
    contentType,
    headers: responseHeaders,
    request,
    elapsedMs,
  }
}

/**
 * Execute a raw streaming HTTP request without an API spec (Tier 3: zero spec).
 * Returns an async iterable of SSE events.
 *
 * @param url - Full URL to request
 * @param options - Request options (method, headers, body, auth, middleware, onEvent callback)
 * @returns Streaming result with an async iterable `stream` property
 * @throws {ApiInvokeError} For network, CORS, timeout, parse, and HTTP errors
 */
export async function executeRawStream(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    auth?: Auth | Auth[]
    middleware?: Middleware[]
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
    signal?: AbortSignal
    accept?: string
    redirect?: RequestInit['redirect']
    onEvent?: (event: SSEEvent) => void
  } = {},
): Promise<StreamingExecutionResult> {
  const operation: Operation = {
    id: 'raw-stream',
    path: '',
    method: options.method ?? HttpMethod.POST,
    parameters: [],
    tags: [],
  }

  return executeOperationStream(url, operation, { body: options.body }, {
    auth: options.auth,
    middleware: options.middleware,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    accept: options.accept,
    redirect: options.redirect,
    headers: options.headers,
    onEvent: options.onEvent,
  })
}

const BINARY_CONTENT_PATTERNS = [
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'audio/',
  'image/',
  'video/',
]

function isBinaryContentType(contentType: string): boolean {
  return BINARY_CONTENT_PATTERNS.some(p => contentType.includes(p))
}
