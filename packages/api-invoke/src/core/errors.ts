/**
 * Classified API errors with human/agent-readable suggestions.
 * Each error has a `kind` for programmatic handling and `retryable` for retry logic.
 */

/**
 * Error classification constants. Use with {@link ApiInvokeError.kind} for programmatic error handling.
 *
 * @example
 * ```ts
 * if (error.kind === ErrorKind.RATE_LIMIT) {
 *   // Wait and retry
 * }
 * ```
 */
export const ErrorKind = {
  CORS: 'cors',
  NETWORK: 'network',
  AUTH: 'auth',
  HTTP: 'http',
  PARSE: 'parse',
  RATE_LIMIT: 'rate-limit',
  TIMEOUT: 'timeout',
  GRAPHQL: 'graphql',
} as const
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind]

/** Error name constant used on all ApiInvokeError instances. Useful for cross-realm `instanceof` checks. */
export const API_INVOKE_ERROR_NAME = 'ApiInvokeError' as const

/**
 * Structured error thrown by api-invoke for all API failures.
 * Includes a machine-readable `kind`, a human-readable `suggestion`, and a `retryable` flag.
 *
 * @example
 * ```ts
 * try {
 *   await client.execute('getUser', { userId: 123 })
 * } catch (error) {
 *   if (error instanceof ApiInvokeError) {
 *     console.log(error.kind)       // 'auth', 'network', 'rate-limit', etc.
 *     console.log(error.suggestion) // Human-readable recovery advice
 *     console.log(error.retryable)  // Whether retrying might succeed
 *   }
 * }
 * ```
 */
export class ApiInvokeError extends Error {
  /** Error classification for programmatic handling. */
  readonly kind: ErrorKind | string
  /** HTTP status code, if the error originated from an HTTP response. */
  readonly status?: number
  /** Human-readable suggestion for how to resolve this error. */
  readonly suggestion: string
  /** Whether retrying the request might succeed (e.g. true for rate limits, network errors). */
  readonly retryable: boolean
  /** Response body from the API (when available). May be parsed JSON, a string, or binary data depending on the response content type. */
  readonly responseBody?: unknown

  constructor(opts: {
    kind: ErrorKind | string
    message: string
    suggestion: string
    retryable?: boolean
    status?: number
    responseBody?: unknown
  }) {
    super(opts.message)
    this.name = API_INVOKE_ERROR_NAME
    this.kind = opts.kind
    this.suggestion = opts.suggestion
    this.retryable = opts.retryable ?? false
    this.status = opts.status
    this.responseBody = opts.responseBody
  }
}

/**
 * Create a CORS error for when a browser request is blocked by the same-origin policy.
 * @param url - The URL that was blocked
 * @returns An `ApiInvokeError` with `kind: 'cors'` and `retryable: false`
 */
export function corsError(url: string): ApiInvokeError {
  return new ApiInvokeError({
    kind: ErrorKind.CORS,
    message: `Cannot access ${url} — blocked by CORS policy.`,
    suggestion: 'This API does not allow browser requests. Use a CORS proxy or server-side execution.',
    retryable: false,
  })
}

/**
 * Create a network error for connection failures.
 * @param url - The URL that failed to connect
 * @returns An `ApiInvokeError` with `kind: 'network'` and `retryable: true`
 */
export function networkError(url: string): ApiInvokeError {
  return new ApiInvokeError({
    kind: ErrorKind.NETWORK,
    message: `Network error while fetching ${url}.`,
    suggestion: 'Check your internet connection and verify the URL is correct.',
    retryable: true,
  })
}

/**
 * Create an authentication/authorization error (401 or 403).
 * @param url - The URL that returned the error
 * @param status - HTTP status code (401 or 403)
 * @param responseBody - Parsed response body, if available
 * @returns An `ApiInvokeError` with `kind: 'auth'` and `retryable: false`
 */
export function authError(url: string, status: 401 | 403, responseBody?: unknown): ApiInvokeError {
  return new ApiInvokeError({
    kind: ErrorKind.AUTH,
    message: status === 401
      ? `Authentication failed for ${url} (401)`
      : `Authorization denied for ${url} (403)`,
    suggestion: status === 401
      ? 'Check your credentials. The server rejected your authentication.'
      : 'Your credentials are valid but you lack permission for this resource.',
    retryable: false,
    status,
    responseBody,
  })
}

/**
 * Create an HTTP error for non-2xx responses (excluding 401/403 which use {@link authError}).
 * Status 429 is classified as `kind: 'rate-limit'`; all others as `kind: 'http'`.
 * @param url - The URL that returned the error
 * @param status - HTTP status code
 * @param statusText - HTTP status text (e.g. 'Not Found')
 * @param responseBody - Parsed response body, if available
 * @returns An `ApiInvokeError` with `retryable: true` for 429 and 5xx status codes
 */
export function httpError(url: string, status: number, statusText: string, responseBody?: unknown): ApiInvokeError {
  const retryable = status === 429 || status >= 500
  const kind = status === 429 ? ErrorKind.RATE_LIMIT : ErrorKind.HTTP

  let suggestion: string
  if (status === 404) {
    suggestion = 'The endpoint was not found. Check the URL path.'
  } else if (status === 429) {
    suggestion = 'Rate limited. Wait and retry.'
  } else if (status >= 500) {
    suggestion = 'The API server is having issues. Try again later.'
  } else {
    suggestion = `The API returned an error (${status}). Verify the request.`
  }

  return new ApiInvokeError({
    kind,
    message: `API returned ${status} ${statusText} for ${url}.`,
    suggestion,
    retryable,
    status,
    responseBody,
  })
}

/**
 * Create a parse error for when the response body cannot be read as the expected format.
 * @param url - The URL that returned the unparseable response
 * @param expectedType - The expected format (default: 'JSON')
 * @returns An `ApiInvokeError` with `kind: 'parse'` and `retryable: false`
 */
export function parseError(url: string, expectedType = 'JSON'): ApiInvokeError {
  return new ApiInvokeError({
    kind: ErrorKind.PARSE,
    message: `Failed to parse response from ${url} as ${expectedType}.`,
    suggestion: `The API response body could not be read as ${expectedType}. Verify the endpoint returns the expected content type.`,
    retryable: false,
  })
}

/**
 * Create a GraphQL error for when the response contains errors and no data (total failure).
 * @param messages - Joined error messages from the GraphQL response
 * @param status - HTTP status code (usually 200 for GraphQL)
 * @param responseBody - Full GraphQL response body
 * @returns An `ApiInvokeError` with `kind: 'graphql'` and `retryable: false`
 */
export function graphqlError(messages: string, status?: number, responseBody?: unknown): ApiInvokeError {
  return new ApiInvokeError({
    kind: ErrorKind.GRAPHQL,
    message: `GraphQL errors: ${messages}`,
    suggestion: 'Check the query and variables for correctness.',
    retryable: false,
    status,
    responseBody,
  })
}

/**
 * Create a timeout error for when a request exceeds the configured `timeoutMs`.
 * @param url - The URL that timed out
 * @returns An `ApiInvokeError` with `kind: 'timeout'` and `retryable: true`
 */
export function timeoutError(url: string): ApiInvokeError {
  return new ApiInvokeError({
    kind: ErrorKind.TIMEOUT,
    message: `Request to ${url} timed out.`,
    suggestion: 'The server took too long to respond. Try again or increase the timeout.',
    retryable: true,
  })
}
