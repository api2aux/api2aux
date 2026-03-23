/**
 * Core types for api-invoke.
 * Spec-agnostic — these work with any API format (OpenAPI, GraphQL, raw URL, manual builder).
 * All enums use `as const` objects for autocomplete + extensibility.
 */

import { ErrorKind } from './errors'

// === Constants ===

/** Standard HTTP methods supported by api-invoke. */
export const HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
} as const
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod]

/** Where a parameter is located in the HTTP request. */
export const ParamLocation = {
  PATH: 'path',
  QUERY: 'query',
  HEADER: 'header',
  COOKIE: 'cookie',
} as const
export type ParamLocation = (typeof ParamLocation)[keyof typeof ParamLocation]

/** Supported authentication types. */
export const AuthType = {
  BEARER: 'bearer',
  BASIC: 'basic',
  API_KEY: 'apiKey',
  QUERY_PARAM: 'queryParam',
  OAUTH2: 'oauth2',
  COOKIE: 'cookie',
} as const
export type AuthType = (typeof AuthType)[keyof typeof AuthType]

/** Detected API specification format. */
export const SpecFormat = {
  OPENAPI_3: 'openapi-3',
  OPENAPI_2: 'openapi-2',
  RAW_URL: 'raw-url',
  MANUAL: 'manual',
  GRAPHQL: 'graphql',
} as const
export type SpecFormat = (typeof SpecFormat)[keyof typeof SpecFormat]

/** Well-known HTTP header names used internally. */
export const HeaderName = {
  ACCEPT: 'Accept',
  AUTHORIZATION: 'Authorization',
  CONTENT_TYPE: 'Content-Type',
  COOKIE: 'Cookie',
} as const
export type HeaderName = (typeof HeaderName)[keyof typeof HeaderName]

// === Parsed API (spec-agnostic) ===

/**
 * A parsed API specification, normalized into a spec-agnostic format.
 * This is the central data model — all adapters (OpenAPI, GraphQL, raw URL, manual builder) produce this shape.
 */
export interface ParsedAPI {
  /** Human-readable API title (e.g. 'Petstore API'). */
  title: string
  /** API version string from the spec (e.g. '1.0.0'). */
  version: string
  /** Base URL for all operations (e.g. 'https://api.example.com/v1'). */
  baseUrl: string
  /** All available API operations extracted from the spec. */
  operations: Operation[]
  /** Authentication schemes declared in the spec. */
  authSchemes: AuthScheme[]
  /** Which adapter produced this ParsedAPI. */
  specFormat: SpecFormat | string
  /** Raw spec version string from the spec (e.g. '3.0.3', '2.0'). Only set for OpenAPI specs. */
  rawSpecVersion?: string
}

/**
 * A single API operation (endpoint + method).
 * Produced by parsing a spec or using the manual builder.
 */
export interface Operation {
  /** Unique identifier for this operation (e.g. 'listUsers', 'get_users'). */
  id: string
  /** URL path template with placeholders (e.g. '/users/{userId}'). */
  path: string
  /** HTTP method (e.g. 'GET', 'POST'). */
  method: HttpMethod | string
  /** Short summary of what this operation does. */
  summary?: string
  /** Longer description of the operation's behavior. */
  description?: string
  /** Parameters accepted by this operation (path, query, header, cookie). */
  parameters: Parameter[]
  /** Request body definition, if the operation accepts one. */
  requestBody?: RequestBody
  /** Primary response schema for the operation's success case. For OpenAPI specs, this is the first 2xx schema found (see parser for priority). Useful for code generation or validation. */
  responseSchema?: unknown
  /** Success and default response schemas keyed by HTTP status code (e.g. '200', '201', 'default'). Codes without schemas (e.g. 204 No Content) are omitted. Error codes (4xx/5xx) are not extracted. */
  responseSchemas?: Record<string, unknown>
  /** Primary response content type (e.g. 'application/json', 'application/xml'). Used as the default Accept header. */
  responseContentType?: ContentType | string
  /** Error response descriptions keyed by HTTP status code (e.g. '404' → 'User not found'). Extracted from 4xx/5xx responses in the spec. */
  errorHints?: Record<string, string>
  /** Tags for grouping operations (e.g. ['users', 'admin']). */
  tags: string[]
  /** Security scheme names required by this operation. Each inner array is an alternative (OR); items within are required together (AND). Empty array (`[]`) means explicitly no auth. `undefined` means no security info available. */
  security?: string[][]
  /**
   * Custom body builder for protocol adapters (e.g., GraphQL).
   * When set and no explicit 'body' key is in args, the executor calls this instead of flat-arg assembly to construct the request body.
   * Receives the full args map and returns the body data to be serialized.
   */
  buildBody?: (args: Record<string, unknown>) => unknown
}

/**
 * A parameter accepted by an API operation.
 */
export interface Parameter {
  /** Parameter name as used in the request (e.g. 'userId', 'page'). */
  name: string
  /** Where this parameter appears in the request. */
  in: ParamLocation
  /** Whether this parameter must be provided. Path parameters are always required. */
  required: boolean
  /** Human-readable description of the parameter. */
  description: string
  /** Type and constraint information for this parameter. */
  schema: ParameterSchema
}

/**
 * Type and constraint information for a parameter.
 */
export interface ParameterSchema {
  /** Data type (e.g. 'string', 'integer', 'boolean', 'array'). */
  type: string
  /** Format hint (e.g. 'int32', 'date-time', 'email', 'uuid'). */
  format?: string
  /** Allowed values for this parameter. */
  enum?: unknown[]
  /** Default value used when the parameter is not provided. */
  default?: unknown
  /** Example value for documentation and testing. */
  example?: unknown
  /** Minimum value for numeric parameters. */
  minimum?: number
  /** Maximum value for numeric parameters. */
  maximum?: number
  /** Maximum length for string parameters. */
  maxLength?: number
  /** Element schema for array parameters. */
  items?: ParameterSchema
}

/** Well-known MIME content types. */
export const ContentType = {
  JSON: 'application/json',
  FORM_URLENCODED: 'application/x-www-form-urlencoded',
  MULTIPART: 'multipart/form-data',
  XML: 'application/xml',
  OCTET_STREAM: 'application/octet-stream',
  TEXT: 'text/plain',
  SSE: 'text/event-stream',
} as const
export type ContentType = (typeof ContentType)[keyof typeof ContentType]

/**
 * Request body definition for an operation.
 */
export interface RequestBody {
  /** Whether the request body is required for this operation. */
  required: boolean
  /** Human-readable description of the request body. */
  description?: string
  /** Content type for the request body (e.g. 'application/json'). */
  contentType: ContentType | string
  /** Schema describing the request body structure. */
  schema: RequestBodySchema
}

/**
 * Schema for a request body, with flattened top-level properties for easy access.
 */
export interface RequestBodySchema {
  /** Top-level type (usually 'object'). */
  type: string
  /** Original unprocessed schema from the spec. Useful for advanced use cases like code generation. */
  raw: unknown
  /** Flattened top-level properties, keyed by property name. Only present when type is 'object'. */
  properties?: Record<string, RequestBodyProperty>
  /** Names of required properties. */
  required?: string[]
}

/**
 * A single property within a request body schema.
 */
export interface RequestBodyProperty {
  /** Data type (e.g. 'string', 'integer', 'boolean'). */
  type: string
  /** Format hint (e.g. 'date-time', 'email'). */
  format?: string
  /** Human-readable description of this property. */
  description?: string
  /** Allowed values for this property. */
  enum?: unknown[]
  /** Default value for this property. */
  default?: unknown
  /** Example value for documentation and testing. */
  example?: unknown
  /** True when this property is an object or array with nested structure. Useful for UI rendering decisions. */
  nested?: boolean
}

// === Authentication ===

/**
 * An authentication scheme declared in the API spec.
 * Describes how the API expects credentials to be provided, but does not contain actual credentials.
 */
export interface AuthScheme {
  /** Scheme name from the spec (e.g. 'bearerAuth', 'api_key'). */
  name: string
  /** Mapped auth type, or null if the scheme is unsupported. */
  authType: AuthType | null
  /** Additional scheme-specific metadata (e.g. header name for API keys, OAuth2 URLs). */
  metadata: Record<string, string>
  /** Human-readable description of the auth scheme. */
  description: string
}

/**
 * Credentials for authenticating API requests.
 * Discriminated union on `type` — use the `AuthType` constants to construct.
 *
 * @example
 * // Bearer token
 * const auth: Auth = { type: AuthType.BEARER, token: 'sk-...' }
 *
 * @example
 * // API key in a header
 * const auth: Auth = { type: AuthType.API_KEY, location: ParamLocation.HEADER, name: 'X-API-Key', value: 'my-key' }
 */
export type Auth =
  | { type: typeof AuthType.BEARER; token: string }
  | { type: typeof AuthType.BASIC; username: string; password: string }
  | { type: typeof AuthType.API_KEY; location: typeof ParamLocation.HEADER | typeof ParamLocation.QUERY; name: string; value: string }
  | { type: typeof AuthType.OAUTH2; accessToken: string; refreshToken?: string; tokenUrl?: string; clientId?: string; clientSecret?: string }
  | { type: typeof AuthType.COOKIE; name: string; value: string }

// === Execution ===

/**
 * A fully constructed HTTP request ready to be sent (or previewed).
 * Produced by {@link buildRequest} and included in execution results for debugging.
 */
export interface BuiltRequest {
  /** HTTP method (e.g. 'GET', 'POST'). */
  method: HttpMethod | string
  /** Fully resolved URL with path and query parameters substituted. */
  url: string
  /** Request headers including auth, content-type, and accept. */
  headers: Record<string, string>
  /** Serialized request body, if present. String for JSON/form-urlencoded, FormData for multipart. */
  body?: string | FormData
}

/**
 * Subset of {@link ErrorKind} that can appear on {@link ExecutionResult.errorKind}.
 * Only HTTP-response errors — client-side errors (CORS, NETWORK, TIMEOUT) always throw regardless of `throwOnHttpError`.
 */
export type ResultErrorKind = typeof ErrorKind.AUTH | typeof ErrorKind.RATE_LIMIT | typeof ErrorKind.HTTP

/**
 * Result of executing an API operation.
 * Contains the parsed response data, status, headers, timing, and the original request for debugging.
 */
export interface ExecutionResult {
  /** HTTP status code (e.g. 200, 404, 500). */
  status: number
  /** Parsed response body. JSON responses are parsed to objects; binary responses are ArrayBuffers; others attempt JSON parsing before falling back to strings. */
  data: unknown
  /** Response content type from the Content-Type header (e.g. 'application/json', 'text/xml'). */
  contentType: string
  /** Response headers as a flat key-value map. */
  headers: Record<string, string>
  /** The request that was sent, useful for debugging and logging. */
  request: BuiltRequest
  /** Request duration in milliseconds (from send to response headers received, before body parsing). */
  elapsedMs: number
  /** Set when `throwOnHttpError` is false and the response is an error. Allows programmatic error classification without throwing. */
  errorKind?: ResultErrorKind
}

// === Streaming ===

/**
 * A parsed Server-Sent Event.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events
 */
export interface SSEEvent {
  /** Event type (e.g. 'message', 'error'). Absent when no `event:` field was set in the stream. */
  event?: string
  /** Event payload. For JSON-encoded events, this is the raw string — parse it with `JSON.parse()`. */
  data: string
  /** Last event ID. Per spec, values containing U+0000 NULL are ignored by the parser. */
  id?: string
  /** Reconnection time in milliseconds. Must be a non-negative integer per spec. */
  retry?: number
}

/**
 * Result of a streaming API call. Errors always throw before this object is constructed,
 * so `status` is guaranteed to be 2xx. The `stream` is single-use — iterating it twice
 * will fail since the underlying ReadableStream reader can only be consumed once.
 * Unlike `ExecutionResult`, `elapsedMs` measures time to receive the response headers (not total stream consumption time)
 * and `errorKind` is absent (errors throw, no non-throwing mode for streams).
 */
export interface StreamingExecutionResult {
  /** HTTP status code (guaranteed 2xx). */
  status: number
  /** Async iterable of SSE events. Single-use — can only be iterated once. */
  stream: AsyncIterable<SSEEvent>
  /** Response content type (expected: 'text/event-stream'). */
  contentType: string
  /** Response headers as a flat key-value map. */
  headers: Record<string, string>
  /** The request that was sent. */
  request: BuiltRequest
  /** Time-to-first-byte in milliseconds (not total stream consumption time). */
  elapsedMs: number
}

// === Enricher ===

/**
 * Post-processing hook that transforms a ParsedAPI after parsing.
 * Useful for adding custom operations, modifying base URLs, or injecting metadata.
 */
export interface Enricher {
  /** Enricher name for identification in logs and debugging. */
  readonly name: string
  /**
   * Transform the parsed API. May return a new object or modify in place.
   * Can be async for enrichers that need to fetch external data.
   */
  enrichAPI(api: ParsedAPI): ParsedAPI | Promise<ParsedAPI>
}

// === Client Options ===

/**
 * Configuration options for {@link ApiInvokeClient} and {@link createClient}.
 */
export interface ClientOptions {
  /** Original spec URL, used for base URL fallback when the spec has no servers/host field. */
  specUrl?: string
  /** Default authentication credentials for all operations. Can be overridden per-call. */
  auth?: Auth | Auth[]
  /** Middleware pipeline applied to every request/response (e.g. logging, CORS proxy). */
  middleware?: Middleware[]
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. Useful for testing or wrapping with {@link withRetry}. */
  fetch?: typeof globalThis.fetch
  /** Post-parse enricher that transforms the ParsedAPI before client construction. */
  enricher?: Enricher
  /** Default timeout in milliseconds for all operations. 0 = no timeout (default). */
  timeoutMs?: number
}

// === Middleware ===

/**
 * Middleware hook for intercepting requests and responses.
 * All hooks are optional — implement only the ones you need.
 */
export interface Middleware {
  /** Middleware name for identification in logs and debugging. */
  name?: string
  /**
   * Called before each request is sent. Can modify the URL and request init.
   * Middleware runs in order — later middleware sees changes from earlier ones.
   */
  onRequest?(url: string, init: RequestInit): { url: string; init: RequestInit } | Promise<{ url: string; init: RequestInit }>
  /**
   * Called after receiving a response. Can transform or replace the response.
   * Runs in order — later middleware sees the response from earlier ones.
   */
  onResponse?(response: Response): Response | Promise<Response>
  /**
   * Called when a fetch error occurs (network failure, CORS, timeout).
   * For logging/monitoring only — cannot recover from the error.
   * Exceptions thrown by this handler are suppressed (logged as warnings).
   */
  onError?(error: Error): void
}
