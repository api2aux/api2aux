/**
 * Manual API definition builder — define APIs without writing a full OpenAPI spec.
 * Supports multiple endpoints, methods, parameters, and request bodies.
 *
 * @example
 * ```ts
 * const api = defineAPI('My API')
 *   .baseUrl('https://api.example.com')
 *   .get('/users', { id: 'listUsers', summary: 'List all users' })
 *   .post('/users', {
 *     id: 'createUser',
 *     body: { contentType: 'application/json', properties: { name: 'string', email: 'string' } },
 *   })
 *   .build()
 * ```
 */

import type { ParsedAPI, Operation, Parameter, RequestBody, RequestBodyProperty } from '../../core/types'
import { ContentType, HttpMethod, ParamLocation, SpecFormat } from '../../core/types'

/**
 * Options for defining an endpoint in the manual builder.
 */
export interface EndpointOptions {
  /** Custom operation ID. Auto-generated from method + path if omitted (e.g. 'get_users'). */
  id?: string
  /** Short summary of what this endpoint does. */
  summary?: string
  /** Longer description of the endpoint's behavior. */
  description?: string
  /** Parameter definitions. Keys are parameter names; values are type strings (shorthand) or full {@link ParamDef} objects. Path parameters from `{placeholders}` are auto-detected. */
  params?: Record<string, ParamDef | string>
  /** Request body definition. */
  body?: BodyDef
  /** Expected response content type. Used as the default Accept header. */
  responseContentType?: ContentType | string
  /** Tags for grouping this endpoint. */
  tags?: string[]
}

/**
 * Parameter definition for the manual builder.
 * All fields are optional — defaults to a non-required query string parameter of type 'string'.
 */
export type ParamDef = {
  /** Where the parameter appears. Default: 'query' (path params are always forced to 'path'). */
  in?: ParamLocation
  /** Whether this parameter is required. Default: false (path params are always required). */
  required?: boolean
  /** Data type. Default: 'string'. */
  type?: string
  /** Human-readable description. */
  description?: string
  /** Default value when the parameter is not provided. */
  default?: unknown
}

/**
 * Request body definition for the manual builder.
 */
export type BodyDef = {
  /** Content type for the body. Default: 'application/json'. */
  contentType?: string
  /** Whether the body is required. Default: true. */
  required?: boolean
  /** Body properties. Keys are property names; values are type strings (shorthand) or full {@link PropertyDef} objects. */
  properties?: Record<string, string | PropertyDef>
  /** Names of required properties within the body. */
  requiredFields?: string[]
}

/**
 * Property definition within a request body.
 */
export type PropertyDef = {
  /** Data type (e.g. 'string', 'integer', 'boolean'). */
  type: string
  /** Human-readable description. */
  description?: string
  /** Format hint (e.g. 'date-time', 'email'). */
  format?: string
  /** Allowed values for this property. */
  enum?: unknown[]
}

/**
 * Fluent builder for manually defining APIs without an OpenAPI spec.
 * Use {@link defineAPI} to create an instance.
 *
 * @example
 * ```ts
 * const api = defineAPI('Users API')
 *   .baseUrl('https://api.example.com')
 *   .get('/users', { id: 'listUsers' })
 *   .get('/users/{userId}', { id: 'getUser' })
 *   .post('/users', { id: 'createUser', body: { properties: { name: 'string' } } })
 *   .build()
 * ```
 */
export class APIBuilder {
  private _title: string
  private _version = '1.0.0'
  private _baseUrl = ''
  private _operations: Operation[] = []

  constructor(title: string) {
    this._title = title
  }

  /**
   * Set the API version string.
   * @param v - Version string (e.g. '2.0.0'). Default: '1.0.0'.
   */
  version(v: string): this {
    this._version = v
    return this
  }

  /**
   * Set the base URL for all endpoints.
   * @param url - Base URL (e.g. 'https://api.example.com/v1'). Required before calling {@link build}.
   */
  baseUrl(url: string): this {
    this._baseUrl = url
    return this
  }

  /** Add a GET endpoint. */
  get(path: string, options: EndpointOptions = {}): this {
    return this.endpoint(HttpMethod.GET, path, options)
  }

  /** Add a POST endpoint. */
  post(path: string, options: EndpointOptions = {}): this {
    return this.endpoint(HttpMethod.POST, path, options)
  }

  /** Add a PUT endpoint. */
  put(path: string, options: EndpointOptions = {}): this {
    return this.endpoint(HttpMethod.PUT, path, options)
  }

  /** Add a PATCH endpoint. */
  patch(path: string, options: EndpointOptions = {}): this {
    return this.endpoint(HttpMethod.PATCH, path, options)
  }

  /** Add a DELETE endpoint. */
  delete(path: string, options: EndpointOptions = {}): this {
    return this.endpoint(HttpMethod.DELETE, path, options)
  }

  /**
   * Add an endpoint with any HTTP method.
   * Path parameters are auto-detected from `{placeholder}` segments.
   *
   * @param method - HTTP method (e.g. 'GET', 'POST')
   * @param path - URL path template (e.g. '/users/{userId}')
   * @param options - Endpoint configuration
   */
  endpoint(method: string, path: string, options: EndpointOptions = {}): this {
    const id = options.id ?? `${method.toLowerCase()}_${path.replace(/[{}\/]/g, '_').replace(/^_|_$/g, '').replace(/_+/g, '_')}`

    // Auto-detect path params from {param} placeholders
    const pathParamNames = [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]!)

    const parameters: Parameter[] = []

    // Add path params from path template
    for (const name of pathParamNames) {
      const explicit = options.params?.[name]
      const def = typeof explicit === 'string'
        ? { type: explicit }
        : explicit ?? {}
      parameters.push({
        name,
        in: ParamLocation.PATH,
        required: true,
        description: def.description ?? '',
        schema: { type: def.type ?? 'string', default: def.default },
      })
    }

    // Add remaining params (query/header/cookie)
    if (options.params) {
      for (const [name, raw] of Object.entries(options.params)) {
        if (pathParamNames.includes(name)) continue // already added
        const def = typeof raw === 'string' ? { type: raw } : raw
        parameters.push({
          name,
          in: def.in ?? ParamLocation.QUERY,
          required: def.required ?? false,
          description: def.description ?? '',
          schema: { type: def.type ?? 'string', default: def.default },
        })
      }
    }

    // Build request body
    let requestBody: RequestBody | undefined
    if (options.body) {
      const properties: Record<string, RequestBodyProperty> = {}
      if (options.body.properties) {
        for (const [name, raw] of Object.entries(options.body.properties)) {
          if (typeof raw === 'string') {
            properties[name] = { type: raw }
          } else {
            properties[name] = {
              type: raw.type,
              description: raw.description,
              format: raw.format,
              enum: raw.enum,
            }
          }
        }
      }
      requestBody = {
        required: options.body.required ?? true,
        contentType: options.body.contentType ?? ContentType.JSON,
        schema: {
          type: 'object',
          raw: {},
          properties,
          required: options.body.requiredFields,
        },
      }
    }

    this._operations.push({
      id,
      path,
      method: method.toUpperCase(),
      summary: options.summary,
      description: options.description,
      parameters,
      requestBody,
      responseContentType: options.responseContentType,
      tags: options.tags ?? [],
    })

    return this
  }

  /**
   * Build the {@link ParsedAPI} from the configured endpoints.
   * @returns A ParsedAPI ready to use with {@link ApiInvokeClient}
   * @throws {Error} If `baseUrl` is not set or no endpoints are defined
   */
  build(): ParsedAPI {
    if (!this._baseUrl) {
      throw new Error('baseUrl is required. Call .baseUrl("https://...") before .build().')
    }
    if (this._operations.length === 0) {
      throw new Error('At least one endpoint is required. Call .get(), .post(), etc. before .build().')
    }
    return {
      title: this._title,
      version: this._version,
      baseUrl: this._baseUrl,
      operations: [...this._operations],
      authSchemes: [],
      specFormat: SpecFormat.MANUAL,
    }
  }
}

/**
 * Create a new API builder with a fluent interface.
 *
 * @param title - Human-readable API title
 * @returns A new {@link APIBuilder} instance
 *
 * @example
 * ```ts
 * const api = defineAPI('My API')
 *   .baseUrl('https://api.example.com')
 *   .get('/health', { id: 'healthCheck' })
 *   .build()
 * ```
 */
export function defineAPI(title: string): APIBuilder {
  return new APIBuilder(title)
}
