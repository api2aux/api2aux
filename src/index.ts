/**
 * api-invoke — Parse any API spec and execute operations.
 */

// Main client
export { createClient, ApiInvokeClient } from './client'

// Core types
export type {
  ParsedAPI,
  Operation,
  Parameter,
  ParameterSchema,
  RequestBody,
  RequestBodySchema,
  RequestBodyProperty,
  Auth,
  AuthScheme,
  ExecutionResult,
  ResultErrorKind,
  SSEEvent,
  StreamingExecutionResult,
  ClientOptions,
  Middleware,
  Enricher,
} from './core/types'

// Constants
export {
  HttpMethod,
  ParamLocation,
  AuthType,
  ContentType,
  HeaderName,
  SpecFormat,
} from './core/types'

// Errors
export {
  ApiInvokeError,
  API_INVOKE_ERROR_NAME,
  ErrorKind,
  corsError,
  networkError,
  authError,
  httpError,
  parseError,
  graphqlError,
  timeoutError,
} from './core/errors'

// Execution
export { executeOperation, executeRaw, executeOperationStream, executeRawStream, buildRequest } from './core/executor'
export type { ExecuteOptions, BuildRequestOptions, BuiltRequest } from './core/executor'

// SSE parser (advanced usage)
export { parseSSE } from './core/sse'

// Detection utilities
export { isSpecUrl, isSpecContent, isGraphQLUrl } from './core/detection'

// URL utilities
export { buildUrl, deriveBaseUrl } from './core/url-builder'

// Auth utilities
export { injectAuth, maskAuth, refreshOAuth2Token } from './core/auth'
export type { AuthenticatedRequest, OAuth2TokenResult } from './core/auth'
export { toAuth, AuthConfigType } from './core/auth-config'
export type { AuthConfig } from './core/auth-config'

// Middleware
export { withRetry, corsProxy, logging, withOAuthRefresh } from './middleware'
export type { RetryOptions, CorsProxyOptions, LoggingOptions, OAuthRefreshOptions } from './middleware'

// Adapters (for advanced usage)
export { parseOpenAPISpec } from './adapters/openapi/parser'
export { parseRawUrl, parseRawUrls } from './adapters/raw/parser'
export type { RawEndpoint } from './adapters/raw/parser'
export { defineAPI, APIBuilder } from './adapters/manual/builder'
export type { EndpointOptions, ParamDef, BodyDef, PropertyDef } from './adapters/manual/builder'

// GraphQL adapter
export { parseGraphQLSchema } from './adapters/graphql/parser'
export type { GraphQLParseOptions } from './adapters/graphql/parser'
export { hasGraphQLErrors, getGraphQLErrors, throwOnGraphQLErrors } from './adapters/graphql/errors'
export type { GraphQLError } from './adapters/graphql/errors'
